---
status: draft
module: identity
min_implementer: mid
depends_on: ['003']
---

# 005 — Reseteo de contraseña

## Context

**Today (plans 001-003, `done`).** A `User` has `email`, `passwordHash`, `status` and
`employeeId`, and can only be created (`register`) or disabled (`disable`); there is no way to
change the password (`apps/api/src/modules/identity/domain/user.ts:8-14,32-63`). `canSignIn` is
false for `DISABLED` users (`user.ts:53-56`). `UserRepository` has `findById`, `findByEmail`,
`findByEmployeeId` and an upsert `save` that writes the **full snapshot**
(`domain/user.repository.ts:6-12`, `infrastructure/prisma-user.repository.ts:36-57`). The password
policy is `checkPasswordPolicy` (12-128 code points, `domain/password-policy.ts:6-19`).
`SessionRepository.revokeAllForUser(userId, now)` closes every open session of a user
(`domain/session.repository.ts:14-18`, `infrastructure/prisma-session.repository.ts:31-37`).

Plan 003 built everything a reset email needs:

- **Tokens**: `InvitationTokens` (`application/ports/invitation-tokens.ts:1-13`). The adapter is
  a one-line subclass of `CryptoSessionTokens`: 256 bits, SHA-256, only the hash is stored
  (`infrastructure/crypto-invitation-tokens.ts:1-6`).
- **Aggregate**: `Invitation`, with `issue` / `isPendingAt` / `accept` / `supersede`
  (`domain/invitation.ts:37-111`).
- **Conditional save**: its repository never overwrites an accepted or superseded row and returns
  `false` when that happens (`domain/invitation.repository.ts:11-16`,
  `infrastructure/prisma-invitation.repository.ts:37-52`). The in-memory fake returns copies and
  applies the same guard (`infrastructure/in-memory/in-memory-invitation.repository.ts`).
- **Email job**: `SendInvitationEmail` (`application/jobs/send-invitation-email.job.ts:1-49`) is
  enqueued with `{ sensitive: true }` (`application/commands/invite-employee.command.ts:122-123`).
- **Lost-race handling**: `ActivateAccount` turns a lost race at commit into
  `InvitationNotValidError` through an internal error that rolls back the transaction
  (`application/commands/activate-account.command.ts:39-40,100-122`).

The company-scoped invite route puts the employee under `/companies/:companyId/employees/:employeeId/…`
so `bindRoute` enforces the company (`packages/contracts/src/identity/invitation.contract.ts:28-38`,
`apps/api/src/http/bind-route.ts:77-93`). A route without `companyParam` is satisfied by **any**
grant of the permission, company-scoped ones included (`bind-route.ts:83-84`,
`shared/application/actor.ts:20-26`). Holding-only routes therefore use a permission that only
`HOLDING_ADMIN` holds, like `identity.users:invite-external`
(`packages/domain/src/identity/access.ts:6-15`, `domain/role-catalog.ts:14-29`).

**Hallazgo L3** (`plans/hallazgos/identity-invitaciones-concurrentes.md`): `InviteEmployee` and
`InviteExternal` supersede pending invitations read-then-write. Two concurrent invitations to the
same colaborador or email both stay pending (`invite-employee.command.ts:98-111`,
`invite-external.command.ts:73-79`). A row lock cannot help when there is no row yet. The existing
lock pattern locks the user row (`infrastructure/prisma-role-assignment.repository.ts:33-38`).

**What we need** (README decisions 23-30):

- "Forgot my password" by email, with a single-use link valid for 1 hour. It answers the same
  whether or not the email exists.
- Setting the new password closes **all** sessions and lifts a login block on that email.
- Admin holding (any user) and RRHH (colaboradores of their companies) can **force** a reset. That
  sends the same email; staff never set the password.
- Fix L3.

**Approach.** Compared (a) reusing `Invitation` with a "kind" column and (b) a separate
`PasswordReset` aggregate and table. Chose (b):

- An invitation creates a `User` and carries `employeeId`/`companyId`. A reset belongs to an
  existing `User`.
- Mixing both would add a state every query must filter on.

The token scheme, the conditional save, the sensitive job and the lost-race handling are copied
from 003. Serialization:

- **Reset requests and confirmation** lock the user row inside the transaction, with a new
  `UserRepository.lock`, the same SQL as `lockUser` in `prisma-role-assignment.repository.ts:33-38`.
  - Two concurrent requests then leave one pending reset.
  - A confirmation re-reads the user after the lock. A termination committed first
    (`disable-terminated-employee.command.ts:36-52`) makes it fail instead of overwriting
    `DISABLED` with the full snapshot.
- **Invitations (L3)**: there is no row to lock before the first invitation. They take Postgres
  transaction-level advisory locks keyed by employee and by email (`pg_advisory_xact_lock`)
  through a new `InvitationRepository.lockIssuance`.
- **Forgot my password**: the same public endpoint could otherwise flood a mailbox. It skips
  sending when the user already has a pending reset younger than a cooldown
  (`PASSWORD_RESET_COOLDOWN_SECONDS`, default 180 = 3 minutes, README decision 30), and still answers 204.

**Imitated files.**

- Aggregate, repository, mapper, Prisma and in-memory adapters: the `Invitation` set
  (`domain/invitation.ts`, `domain/invitation.repository.ts`, `infrastructure/invitation.mapper.ts`,
  `infrastructure/prisma-invitation.repository.ts`,
  `infrastructure/in-memory/in-memory-invitation.repository.ts`).
- Commands: `invite-employee.command.ts` and `activate-account.command.ts`.
- Job: `send-invitation-email.job.ts`. Contract: `invitation.contract.ts`. Router: `http/invitation.router.ts`.

## Out of scope

- Web/mobile screens ("olvidé mi contraseña", `/restablecer`). Plan 004 is deferred. The email
  link points to `${APP_PUBLIC_URL}/restablecer?token=…`, a page that does not exist yet.
- **Changing the password while signed in** (current + new password): it comes with the colaborador self-service endpoints (README decision 29).
- **Staff setting a password directly**: README decision 26 rules it out.
- Clearing the **IP** throttle after a reset. It is shared by everyone behind that IP (README
  decision 12); only the email throttle is cleared (decision 28).
- Response-time equalization between existing and unknown emails. The endpoint always answers
  204 without waiting for the email job, which is the main mitigation.
- Re-enabling disabled users.
- Superseding pending resets on termination. Confirmation already rejects `DISABLED` users.
- Refactoring `RoleAssignmentRepository.lockUser` onto the new `UserRepository.lock`.
- HTML email templates.

## Dependencies

- `identity-acceso/003` (`done`):
  - `InvitationTokens`/`CryptoSessionTokens`, `JobQueue` `sensitive`, `EmailSender`, `APP_PUBLIC_URL`.
  - `EmployeeDirectory`, `EmployeeNotFoundError`.
  - `SessionRepository.revokeAllForUser`.
  - The conditional-save pattern, and `User.employeeId`/`disable`.

## Steps

1. **Vocabulary and contracts**
   - Files:
     - `packages/domain/src/identity/access.ts` (modify)
     - `packages/contracts/src/identity/password-reset.contract.ts` (create)
     - `packages/contracts/src/index.ts` (modify)
     - `packages/contracts/openapi.json` (modify)
   - Do:
     - **Permissions.** Add `identity.users:reset-password` (force a reset for a colaborador of a
       company) and `identity.users:reset-password-any` (force a reset for any user, holding only).
     - **`password-reset.contract.ts`** (group `passwordResetRoutes`):
       - `PasswordResetSchema = z.object({ id: z.uuid(), email: z.email(), expiresAt: z.iso.datetime() }).meta({ id: 'PasswordReset' })`.
       - `requestPasswordReset` `POST /auth/password-reset`:
         - Access `publicAccess`.
         - Body `z.object({ email: z.email().max(254) })`, meta id `RequestPasswordResetInput`.
         - Response `z.undefined()`, 204.
         - Summary: "Envía un enlace para restablecer la contraseña (responde igual exista o no el correo)".
       - `resetPassword` `POST /auth/password-reset/confirm`:
         - Access `publicAccess`.
         - Body `{ token: z.string().min(1).max(200), password: z.string().min(1).max(128) }`, meta
           id `ResetPasswordInput`, with the same comment as `ActivateAccountSchema`: the password
           policy is applied by the use case.
         - Response `z.undefined()`, 204.
       - `forceEmployeePasswordReset` `POST /companies/:companyId/employees/:employeeId/password-reset`:
         - Access `requires('identity.users:reset-password', { companyParam: 'companyId' })`.
         - Params `{ companyId: z.uuid(), employeeId: z.uuid() }`, no body.
         - Response `PasswordResetSchema`, 201.
       - `forceUserPasswordReset` `POST /users/:userId/password-reset`:
         - Access `requires('identity.users:reset-password-any')`.
         - Params `{ userId: z.uuid() }`, no body.
         - Response `PasswordResetSchema`, 201.
     - **`index.ts`**: `export * from './identity/password-reset.contract'`, and add
       `passwordResets: passwordResetRoutes` to `apiRoutes`.
     - **OpenAPI**: regenerate with `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: contracts typecheck; `openapi.json` has the 4 new operations.

2. **Domain: PasswordReset, password change, errors**
   - Files:
     - `apps/api/src/modules/identity/domain/password-reset.ts` (create)
     - `apps/api/src/modules/identity/domain/password-reset.repository.ts` (create)
     - `apps/api/src/modules/identity/domain/user.ts` (modify)
     - `apps/api/src/modules/identity/domain/user.repository.ts` (modify)
     - `apps/api/src/modules/identity/domain/invitation.repository.ts` (modify)
     - `apps/api/src/modules/identity/domain/role-catalog.ts` (modify)
     - `apps/api/src/modules/identity/domain/errors.ts` (modify)
   - Do:
     - **`password-reset.ts`**, shaped like `invitation.ts`:
       - `PasswordResetId`. Props: `{ userId: UserId; tokenHash: string; requestedBy: UserId | null; createdAt; expiresAt; usedAt: Date | null; revokedAt: Date | null }`.
         `requestedBy: null` means the user asked for it; a user id means staff forced it.
       - `static issue({ id, userId, tokenHash, requestedBy, ttlMs, now })` records
         `PASSWORD_RESET_REQUESTED = 'identity.password-reset.requested'` with
         `{ passwordResetId, userId, requestedBy }`. The payload never carries the token hash.
       - `isPendingAt(now)`: not used, not revoked, and `now < expiresAt`.
       - `use(now)`: if not pending, `err(PasswordResetNotValidError)`; otherwise sets `usedAt`
         and records `PASSWORD_RESET_COMPLETED = 'identity.password-reset.completed'`.
       - `supersede(now)`: sets `revokedAt`; no-op if not pending.
       - `restore`, `snapshot`.
     - **`password-reset.repository.ts`**:
       - `findByTokenHash(tokenHash)`.
       - `findPendingForUser(userId, now)`.
       - `save(reset): Promise<boolean>`, with the same doc and semantics as
         `InvitationRepository.save`: a used or superseded row is never overwritten, and it
         returns `false`.
     - **`User`**: `changePassword(passwordHash, now)` replaces the hash and records
       `USER_PASSWORD_CHANGED = 'identity.user.password-changed'` with `{ userId }`.
     - **`UserRepository`**: add `lock(id: UserId): Promise<boolean>`, doc copied from
       `RoleAssignmentRepository.lockUser`. It must run inside `transactionRunner.run`, locks the
       user row until the transaction ends, and returns `false` if the user does not exist.
     - **`InvitationRepository`**: add `lockIssuance(keys: readonly string[]): Promise<void>`.
       - Doc: must run inside `transactionRunner.run`. It serializes the issuance of invitations
         that share a key (hallazgo L3) and holds until the transaction ends.
       - Callers pass keys like `employee:<id>` and `email:<address>`.
     - **`role-catalog.ts`**: `HR` gains `identity.users:reset-password`. `HOLDING_ADMIN` keeps
       all `PERMISSIONS`, so it gets both new ones.
     - **`errors.ts`**:
       - `PasswordResetNotValidError extends BusinessRuleViolationError`
         (`PASSWORD_RESET_NOT_VALID`, "El enlace para restablecer la contraseña no es válido o ya
         expiró"). The same body is used for unknown, expired, used, superseded, and
         user-disabled cases.
       - `UserDisabledError extends BusinessRuleViolationError` (`USER_DISABLED`, "El usuario
         está deshabilitado").
   - Observable result: typecheck and `pnpm arch:check` pass.

3. **Application: issuer, four commands, email job; L3 in the invite commands**
   - Files:
     - `apps/api/src/modules/identity/application/ports/password-reset-tokens.ts` (create)
     - `apps/api/src/modules/identity/application/password-reset-issuer.ts` (create)
     - `apps/api/src/modules/identity/application/commands/request-password-reset.command.ts` (create)
     - `apps/api/src/modules/identity/application/commands/force-employee-password-reset.command.ts` (create)
     - `apps/api/src/modules/identity/application/commands/force-user-password-reset.command.ts` (create)
     - `apps/api/src/modules/identity/application/commands/reset-password.command.ts` (create)
     - `apps/api/src/modules/identity/application/jobs/send-password-reset-email.job.ts` (create)
     - `apps/api/src/modules/identity/application/commands/invite-employee.command.ts` (modify)
     - `apps/api/src/modules/identity/application/commands/invite-external.command.ts` (modify)
   - Do:
     - **`password-reset-tokens.ts`**: `PasswordResetTokens` has the same shape as
       `InvitationTokens` (`issue()`, `hashOf()`).
       `PasswordResetPolicy { ttlMs: number; cooldownMs: number; appPublicUrl: string }`.
     - **`SEND_PASSWORD_RESET_EMAIL = 'identity.send-password-reset-email'`**:
       - Payload `{ to: string; link: string; expiresAt: string; forcedByStaff: boolean }`.
       - Plain Spanish text. Subject "Restablece tu contraseña de RRHH APS".
       - Body: an optional line "Un administrador solicitó restablecer tu contraseña." when
         `forcedByStaff`, the link, and "El enlace vence el … y solo se puede usar una vez". The
         date and time are formatted with `dateStyle: 'long', timeStyle: 'short'` in
         `America/Cancun`.
       - Closing: "Si no lo solicitaste, ignora este correo: tu contraseña no cambia."
       - Never logs the link or the recipient.
     - **`PasswordResetIssuer`**, an application service, not a command. It is registered in the
       module and used by the three request commands.
       - Deps: `passwordResetRepository`, `userRepository`, `passwordResetTokens`,
         `passwordResetPolicy`, `idGenerator`, `transactionRunner`, `clock`, `eventBus`, `jobQueue`.
       - `issue(input: { user: User; requestedBy: UserId | null; respectCooldown: boolean }): Promise<PasswordReset | null>`.
       - Inside `transactionRunner.run`:
         1. `userRepository.lock(user.id)`.
         2. `pending = findPendingForUser(user.id, now)`.
         3. If `respectCooldown` and some pending reset has `createdAt > now - cooldownMs`, return
            `null`.
         4. Supersede and save every pending reset, then issue and save the new one.
       - After commit: publish the reset's events, then
         `jobQueue.enqueue(SEND_PASSWORD_RESET_EMAIL, { to: user.snapshot.email.value, link: `${appPublicUrl}/restablecer?token=${token}`, expiresAt, forcedByStaff: requestedBy !== null }, { sensitive: true })`.
       - Returns the reset.
     - **`RequestPasswordReset`** (input `{ email }`):
       - `Email.create`, `findByEmail`. If the email is invalid, the user is missing, or it cannot
         sign in, return `ok(undefined)` with no work.
       - Otherwise `issuer.issue({ user, requestedBy: null, respectCooldown: true })`.
       - Always `ok(undefined)`. Comment: never reveals whether the account exists (README
         decision 25).
     - **`ForceEmployeePasswordReset`** (input `{ companyId, employeeId, requestedBy }`):
       - `employeeDirectory.find`; missing or a `companyId` mismatch gives `EmployeeNotFoundError`,
         the same as `invite-employee.command.ts:68-73`.
       - `findByEmployeeId`; none gives `UserNotFoundError`.
       - `!canSignIn` gives `UserDisabledError`.
       - Otherwise `issuer.issue({ user, requestedBy, respectCooldown: false })`.
       - Returns `{ id, email, expiresAt }`.
     - **`ForceUserPasswordReset`** (input `{ userId, requestedBy }`):
       - `findById`; none gives `UserNotFoundError`. Disabled gives `UserDisabledError`.
       - Otherwise it issues like the employee variant and returns the same shape.
     - **`ResetPassword`** (input `{ token, password }`):
       1. `checkPasswordPolicy` first.
       2. `reset = findByTokenHash(hashOf(token))`. If not pending, `PasswordResetNotValidError`.
       3. `passwordHasher.hash`, outside the transaction.
       4. Inside `transactionRunner.run`:
          - `userRepository.lock(reset.userId)`.
          - Re-read the user with `findById`. If it is missing or cannot sign in, throw an
            internal `PasswordResetLostError`.
          - `reset.use(now)`, and `passwordResetRepository.save(reset)`; `false` throws
            `PasswordResetLostError`.
          - Supersede and save the user's other pending resets.
          - `user.changePassword(hash, now)`, then `userRepository.save(user)`.
          - `sessionRepository.revokeAllForUser(user.id, now)`.
          - Clear the email login throttle, the same way a successful login does
            (`log-in.command.ts:103-107,190-194`): `loginThrottleRepository.lock(LoginThrottle.keyForEmail(user.snapshot.email), now)`,
            then `throttle.clear(now)` and `loginThrottleRepository.save(throttle)`. Leave the IP
            throttle alone. Lock order is the user row, then the throttle row; login locks only
            throttle rows, so there is no cycle.
          - Deps gain `loginThrottleRepository`.
       5. Catch `PasswordResetLostError` and map it to `PasswordResetNotValidError`, exactly like
          `activate-account.command.ts:117-122`.
       6. Publish the user and reset events after commit. No session is created.
     - **L3**:
       - `InviteEmployee`: the first statement inside its `transactionRunner.run` is
         `await invitationRepository.lockIssuance([`employee:${employee.id}`, `email:${email.value.value}`])`.
       - `InviteExternal`: `lockIssuance([`email:${email.value.value}`])`.
       - The supersede reads already happen inside the transaction, after the lock.
   - Observable result: typecheck and `pnpm arch:check` pass.

4. **Module wiring, router, configuration**
   - Files:
     - `apps/api/src/modules/identity/http/password-reset.router.ts` (create)
     - `apps/api/src/modules/identity/identity.module.ts` (modify)
     - `apps/api/src/modules/identity/infrastructure/crypto-password-reset-tokens.ts` (create)
     - `apps/api/src/config/env.ts` (modify)
     - `apps/api/.env.example` (modify)
   - Do:
     - **Router**, like `invitation.router.ts`:
       - The two force routes pass `requestedBy: requireActor(ctx).userId`.
       - Return `unwrap(...)`.
       - The two public routes return `undefined` (204).
       - Mount it next to the others in the module's `router`.
     - **Registrations**:
       - `passwordResetRepository` (Prisma).
       - `passwordResetTokens`: `CryptoPasswordResetTokens`, a one-line subclass like
         `crypto-invitation-tokens.ts`.
       - `passwordResetPolicy`: `ttlMs = PASSWORD_RESET_TTL_MINUTES * 60_000`,
         `cooldownMs = PASSWORD_RESET_COOLDOWN_SECONDS * 1_000`, and `appPublicUrl` trimmed like
         `invitationPolicy`.
       - `passwordResetIssuer`, the four commands, and `sendPasswordResetEmail`.
       - Add all of them to `IdentityCradle`.
     - **Jobs**: `jobs: ({ sendInvitationEmail, sendPasswordResetEmail }) => [sendInvitationEmail, sendPasswordResetEmail]`.
     - **Env** (Zod, defaults, Spanish comments):
       - `PASSWORD_RESET_TTL_MINUTES` (`60`, README decision 23).
       - `PASSWORD_RESET_COOLDOWN_SECONDS` (`180` = 3 minutes, README decision 30).
       - Mirror both in `.env.example`.
   - Observable result: `tests/container.test.ts` green; the worker lists
     `identity.send-password-reset-email` on start.

5. **Persistence and migration**
   - Files:
     - `apps/api/prisma/schema.prisma` (modify)
     - `apps/api/prisma/migrations/<timestamp>_create_password_resets/migration.sql` (create)
     - `apps/api/src/modules/identity/infrastructure/password-reset.mapper.ts` (create)
     - `apps/api/src/modules/identity/infrastructure/prisma-password-reset.repository.ts` (create)
     - `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-password-reset.repository.ts` (create)
     - `apps/api/src/modules/identity/infrastructure/prisma-user.repository.ts` (modify)
     - `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.repository.ts` (modify)
     - `apps/api/src/modules/identity/infrastructure/prisma-invitation.repository.ts` (modify)
     - `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-invitation.repository.ts` (modify)
   - Do (skill `db-change`):
     - **`model PasswordReset`**:
       - Columns: `id String @id @db.Uuid`, `userId String @map("user_id") @db.Uuid`,
         `user User @relation(fields: [userId], references: [id])` (same module; FK allowed, like
         `Session`), `tokenHash String @unique @map("token_hash") @db.Char(64)`,
         `requestedBy String? @map("requested_by") @db.Uuid`,
         `createdAt DateTime @map("created_at") @db.Timestamptz(3)`, and `expiresAt`, `usedAt?`,
         `revokedAt?` the same way.
       - `@@index([userId]) @@map("password_resets") @@schema("identity")`.
       - `User` gains `passwordResets PasswordReset[]`.
     - **Migration**: `pnpm db:migrate --name create_password_resets`, then `pnpm db:generate`.
       Replace `<timestamp>` here and record it in Deviations.
     - **`PrismaPasswordResetRepository.save`**: the same conditional
       `updateMany WHERE id AND used_at IS NULL AND revoked_at IS NULL`, then `findUnique`, then
       `create`, as `prisma-invitation.repository.ts:37-52`.
     - **In-memory reset repository**: copies plus the same guard, as the invitation fake.
     - **`PrismaUserRepository.lock`**: the SQL of `prisma-role-assignment.repository.ts:33-38`.
       The in-memory version returns whether the user exists.
     - **`PrismaInvitationRepository.lockIssuance`**:
       - For each key, sorted so two transactions always lock in the same order:
         ``await client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`identity.invitation:${key}`}, 0))` ``.
       - If Prisma rejects the `void` result, use
         `$queryRaw` with `…::text` and record it in Deviations.
       - The in-memory version is a no-op.
   - Observable result: the migration creates `identity.password_resets` with a unique token hash,
     an index on `user_id` and an FK only to `identity.users`, and no DROP. `pnpm test:integration`
     is green.

6. **Test harness, docs, and existing tests whose expectations change**
   - Files:
     - Harness and docs:
       - `apps/api/tests/test-app.ts` (modify)
       - `docs/architecture.md` (modify)
       - `plans/identity-acceso/README.md` (modify)
       - `plans/hallazgos/identity-invitaciones-concurrentes.md` (modify)
     - Existing tests:
       - `packages/contracts/src/openapi.test.ts` (modify)
       - `packages/contracts/src/identity/access.contract.test.ts` (modify)
       - `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify)
       - `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify)
   - Do:
     - **`test-app.ts`**: register `passwordResetRepository: asValue(new InMemoryPasswordResetRepository())`.
     - **`architecture.md`**: in the email/sensitive-job section (around line 133), add that
       password-reset emails follow the same rule, and describe the lock strategy (user-row lock
       for resets, advisory locks for invitation issuance).
     - **Hallazgo**: set `status: resolved` and `plan: identity-acceso/005` once implemented. It
       is `planned` at planning time.
     - **Existing tests**, only the expectations this plan changes:
       - Operation count 15 → 19 (`openapi.test.ts:49`).
       - Public routes add `passwordResets.requestPasswordReset` and
         `passwordResets.resetPassword` (`access.contract.test.ts:31`).
       - HR's permission list gains `identity.users:reset-password`, and its grant count goes
         4 → 5 (`role-catalog.test.ts:26,62`, `session-authenticator.test.ts:141,171`).
   - Observable result: `pnpm check` green.

7. **Test files of this plan** (declared for `pnpm plans:scope`; the tester writes them)
   - Files:
     - Contract and domain:
       - `packages/contracts/src/identity/password-reset.contract.test.ts` (create)
       - `apps/api/src/modules/identity/domain/password-reset.test.ts` (create)
       - `apps/api/src/modules/identity/domain/user.test.ts` (modify)
     - Application:
       - `apps/api/src/modules/identity/application/password-reset-issuer.test.ts` (create)
       - `apps/api/src/modules/identity/application/commands/request-password-reset.command.test.ts` (create)
       - `apps/api/src/modules/identity/application/commands/force-employee-password-reset.command.test.ts` (create)
       - `apps/api/src/modules/identity/application/commands/force-user-password-reset.command.test.ts` (create)
       - `apps/api/src/modules/identity/application/commands/reset-password.command.test.ts` (create)
       - `apps/api/src/modules/identity/application/jobs/send-password-reset-email.job.test.ts` (create)
     - HTTP: `apps/api/tests/password-reset.test.ts` (create)
     - Integration:
       - `apps/api/tests/integration/identity/prisma-password-reset.int.test.ts` (create)
       - `apps/api/tests/integration/identity/prisma-user.int.test.ts` (modify)
       - `apps/api/tests/integration/identity/prisma-invitation.int.test.ts` (modify)
   - Do: nothing for the implementer.
   - Observable result: suites green.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass; web and mobile typecheck.
- [ ] Migration `*_create_password_resets` creates `identity.password_resets` (unique `token_hash`,
      FK to `identity.users` only); no DROP.
- [ ] `POST /auth/password-reset` answers **204 with an empty body** for:
  - an existing active user
  - an unknown email
  - a disabled user
  - a second request within the cooldown

  Only the first case sends an email, and it arrives in Mailpit with a
  `${APP_PUBLIC_URL}/restablecer?token=…` link that expires 1 hour later. The job does not remain
  in Valkey.

- [ ] `POST /auth/password-reset/confirm`:
  - With the token and a valid password → 204.
  - After that, login with the new password works and the old password gives 401.
  - Every session the user had before gives 401.
  - If the email was blocked by failed logins (429 `LOGIN_TEMPORARILY_BLOCKED`), login with the
    new password works right after the reset, without waiting for the block to end.
  - These give the same 422 `PASSWORD_RESET_NOT_VALID`: reusing the token, a superseded token (an
    earlier request), an expired or unknown token, and a user disabled after the request.
  - A weak password → 422 `WEAK_PASSWORD`, and the token stays usable.
- [ ] Force reset for a colaborador (`POST /companies/:companyId/employees/:employeeId/password-reset`):
  - HR of that company → 201 `{ id, email, expiresAt }`, and the email says staff requested it.
  - HR of another company's path → 403.
  - An employee of another company, or unknown → 404 `EMPLOYEE_NOT_FOUND`.
  - An employee with no account → 404 `USER_NOT_FOUND`.
  - A disabled account → 422 `USER_DISABLED`.
  - Anonymous → 401.
  - The cooldown does not apply.
- [ ] `POST /users/:userId/password-reset`: Admin holding → 201, also for external users (no
      `employeeId`); HR → 403; unknown user → 404 `USER_NOT_FOUND`.
- [ ] L3: two concurrent invitations to the same colaborador (or the same external email) leave
      exactly one pending invitation — **checked by integration tests** (real Postgres, parallel
      transactions).

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                   |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `PasswordReset` lifecycle (pending/expired/used/superseded); `User.changePassword` event                                                                                                                                |
| application | yes     | every branch of the four commands and the issuer: cooldown, supersede, sensitive enqueue with the `/restablecer` link, lost race rolled back, sessions revoked, email login throttle cleared (IP untouched); email text |
| contract    | yes     | new routes' access (two public, two permissioned, `companyParam`), shapes, OpenAPI snapshot                                                                                                                             |
| http        | yes     | forgot always 204 and the email only for active users; confirm, then login with the new password and the old one rejected; old sessions 401; token reuse; force matrix per role and company                             |
| integration | yes     | conditional save of resets; `UserRepository.lock`; `lockIssuance` serializes two parallel invitation transactions (L3); FK and unique token hash                                                                        |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                             |

## Deviations

## Test coverage

## Review findings

## Verification
