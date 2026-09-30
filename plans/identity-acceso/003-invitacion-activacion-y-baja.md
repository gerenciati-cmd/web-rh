---
status: testing
module: identity
min_implementer: mid
depends_on: ['002']
---

# 003 — Invitación, activación y baja de accesos

## Context

**Today (plans 001 and 002, `done`).** Users exist only through the dev seed
(`apps/api/prisma/seed.ts`); there is no way to create one over HTTP. `User` has `email`,
`passwordHash`, `status: 'ACTIVE' | 'DISABLED'` and no link to a colaborador
(`apps/api/src/modules/identity/domain/user.ts:5-14,21-48`); nothing ever sets `DISABLED`. The role
catalog keeps `EMPLOYEE` (scope `SELF`) inert and not assignable
(`apps/api/src/modules/identity/domain/role-catalog.ts:14-23`); `RoleAssignment.assign` rejects
non-assignable roles and requires a company for non-holding scopes
(`domain/role-assignment.ts:36-74`). The last-admin rule counts active `HOLDING_ADMIN` assignments
without looking at the user's status (`infrastructure/prisma-role-assignment.repository.ts:27-29`) —
README decision 18 asks to fix that once users can be disabled. `SessionRepository` has no way to
revoke all sessions of a user (`domain/session.repository.ts:3-13`). `/auth/me` returns
`{ id, email }` only (`packages/contracts/src/identity/auth.contract.ts:8-11`).

The `employees` module exports only its module and the event names
`EMPLOYEE_HIRED`/`EMPLOYEE_TERMINATED` (`apps/api/src/modules/employees/index.ts:1-3`); `Employee`
has `companyId`, `email`, `status`, names (`domain/employee.ts:18-27`). `terminate()` records
`EMPLOYEE_TERMINATED` with `{ employeeId, terminationDate }` (`domain/employee.ts:91-103`), but **no
command or endpoint calls it yet**. No module subscribes to any event; the mechanism exists
(`apps/api/src/shared/app-module.ts:23-24`, `container.ts:86-91`, in-process bus
`src/infrastructure/events/in-memory-event-bus.ts:75-100`, ADR 0005). Other modules expose
facades like `OrganizationApi` (`modules/organization/application/organization.facade.ts:6-29`).

Async work: `JobQueue.enqueue(name, data, options?)` (`src/shared/application/jobs.ts:5-7`)
implemented by BullMQ with `removeOnComplete: 1_000`, `removeOnFail: 5_000`
(`src/infrastructure/queue/bullmq-job-queue.ts:18-26`) — i.e. job payloads are **kept** in
Valkey. The worker runs `AppModule.jobs` handlers by name (`src/main/worker.ts:19-33`). There is
no email sender and no SMTP configuration in `src/config/env.ts`; Mailpit listens on SMTP
`127.0.0.1:${SMTP_PORT:-1025}` (`infra/docker/docker-compose.yml:64-70`). The HTTP test container
does not replace `jobQueue` (`apps/api/tests/test-app.ts`), so an enqueue in HTTP tests would try
to reach Valkey.

**What we need** (README decisions 19-22): RRHH (their companies) and Admin holding invite a
colaborador; the invitation goes to the ficha's email or an edited one, which becomes the login
email; the invitee activates by setting a password; the account is linked to the colaborador and
gets the `EMPLOYEE` role automatically; a colaborador's termination disables the account and closes
its sessions at once; emails go through a queue processed by the worker. Admin holding can also
invite a person who is not a colaborador (README decision 2). Password reset is plan 005.

**Approach.** Compared (a) creating the `User` at invitation time with no password and (b) a
separate `Invitation` aggregate that creates the `User` only on activation. Chose (b): a `User`
with no password would be a new invalid state every login path must guard against, and pending
invitations need their own lifecycle (expire, be superseded). Tokens are opaque 256-bit and stored
hashed, exactly like sessions (ADR 0011, `CryptoSessionTokens`). The email carries the raw token,
so email jobs are enqueued as **sensitive** (removed from Valkey on completion and failure). The
company scope of an invitation comes from the path (`/companies/:companyId/employees/:employeeId/…`)
so `bindRoute`'s `companyParam` enforces it without new machinery (ADR 0012). The link to
`employees` goes through a new `EmployeesApi` facade + an identity port (ADR 0010 rule 2).

**Imitated files.** Aggregate/repository/mapper/Prisma/in-memory: `identity/domain/session.ts`,
`domain/session.repository.ts`, `infrastructure/session.mapper.ts`,
`infrastructure/prisma-session.repository.ts`, `infrastructure/in-memory/in-memory-session.repository.ts`.
Commands: `identity/application/commands/assign-role.command.ts` (transaction + lock) and
`log-out.command.ts`. Token port/adapter: `application/ports/session-tokens.ts`,
`infrastructure/crypto-session-tokens.ts`. Facade: `organization/application/organization.facade.ts`;
cross-module adapter: `identity/infrastructure/organization-company-directory.ts`. Contract:
`packages/contracts/src/identity/access.contract.ts`.

## Out of scope

- Password reset / "forgot password" (plan 005, same email infrastructure).
- A command or endpoint to terminate a colaborador (belongs to `employees`, with legal rules —
  finiquito). This plan only **reacts** to `EMPLOYEE_TERMINATED`; it is exercised by tests, not by
  HTTP (see acceptance criteria).
- Re-enabling a disabled user, manual disable/enable endpoints, deleting users.
- Self-service endpoints for the Colaborador (their ficha, vacations…): `EMPLOYEE` grants no
  permission yet; it only links the account.
- Enforcing the Jefe directo (team) scope.
- Web/mobile activation screens (plan 004, deferred). The email link points to
  `${APP_PUBLIC_URL}/activar?token=…`, a page that does not exist yet; activation is done through
  the API.
- HTML email templates/branding (plain text is enough).
- Durable events (outbox): if the process dies between the termination commit and the publish,
  the disable is lost (ADR 0005 limitation, accepted).

## Dependencies

- `identity-acceso/002` (`done`): route `access`/`requires` with `companyParam`, `Actor.grants`,
  `hasPermission`, role catalog, `RoleAssignment`, `transactionRunner`-based locks, `PermissionDeniedError`.

## Steps

1. **Vocabulary and contracts**
   - Files: `packages/domain/src/identity/access.ts` (modify), `packages/contracts/src/identity/invitation.contract.ts` (create), `packages/contracts/src/identity/auth.contract.ts` (modify), `packages/contracts/src/index.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do:
     - Add permissions `identity.users:invite` (invite a colaborador of a company) and `identity.users:invite-external` (invite someone who is not a colaborador).
     - `invitation.contract.ts` (group `invitationRoutes`):
       - `inviteEmployee` `POST /companies/:companyId/employees/:employeeId/invitations` — `requires('identity.users:invite', { companyParam: 'companyId' })`; body `z.object({ email: z.email().max(254).optional() })`; response `z.object({ id: z.uuid(), email: z.email(), expiresAt: z.iso.datetime() })`, 201.
       - `inviteExternal` `POST /invitations` — `requires('identity.users:invite-external')`; body `{ email: z.email().max(254) }`; same response, 201.
       - `activateAccount` `POST /auth/activate` — `publicAccess`; body `{ token: z.string().min(1).max(200), password: z.string().min(1).max(128) }`; response `z.undefined()`, 204.
     - `SessionUserSchema` gains `employeeId: z.uuid().nullable()`.
     - `index.ts`: export and add `invitations: invitationRoutes` to `apiRoutes`. Regenerate `openapi.json` with `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: contracts typecheck and tests pass.

2. **Employees facade**
   - Files: `apps/api/src/modules/employees/application/employees.facade.ts` (create), `apps/api/src/modules/employees/employees.module.ts` (modify), `apps/api/src/modules/employees/index.ts` (modify)
   - Do: like `organization.facade.ts`: `EmployeeSummary { id; companyId; email: string; fullName: string; active: boolean }`, `EmployeesApi { findEmployee(employeeId: string): Promise<EmployeeSummary | null> }`, `EmployeesFacade` over `EmployeeRepository.findById` (`active = status === 'ACTIVE'`). Register `employeesApi`; export the types from `index.ts`.
   - Observable result: typecheck; `tests/container.test.ts` green.

3. **Domain: Invitation, User link and disable, EMPLOYEE role**
   - Files: `apps/api/src/modules/identity/domain/invitation.ts` (create), `apps/api/src/modules/identity/domain/invitation.repository.ts` (create), `apps/api/src/modules/identity/domain/user.ts` (modify), `apps/api/src/modules/identity/domain/user.repository.ts` (modify), `apps/api/src/modules/identity/domain/role-assignment.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/session.repository.ts` (modify), `apps/api/src/modules/identity/domain/role-assignment.repository.ts` (modify), `apps/api/src/modules/identity/domain/errors.ts` (modify)
   - Do:
     - `invitation.ts`: `InvitationId`; props `{ email: Email; employeeId: string | null; companyId: string | null; tokenHash: string; invitedBy: UserId; createdAt; expiresAt; acceptedAt: Date | null; revokedAt: Date | null }`. `static issue({ …, ttlMs, now })` (records `INVITATION_ISSUED = 'identity.invitation.issued'`), `isPendingAt(now)` (not accepted, not revoked, `now < expiresAt`), `accept(now)` (pending required, else `InvitationNotValidError`; records `INVITATION_ACCEPTED`), `supersede(now)` (sets `revokedAt`, no-op if not pending), `restore`, `snapshot`.
     - `invitation.repository.ts`: `findById`, `findByTokenHash`, `findPendingForEmployee(employeeId, now)`, `findPendingForEmail(email, now)`, `save`.
     - `User`: prop `employeeId: string | null`; `register` takes optional `employeeId`; `disable(now)` (status `DISABLED`, records `USER_DISABLED = 'identity.user.disabled'`, no-op if already disabled). `UserRepository` adds `findByEmployeeId(employeeId)`; `save` maps a unique violation on `employee_id` to `EmployeeAlreadyLinkedError`.
     - `role-catalog.ts`: `EMPLOYEE` stays `assignable: false` (not assignable over HTTP) with a comment that it is granted only by activation; `HR` gains `identity.users:invite`; `HOLDING_ADMIN` keeps all `PERMISSIONS` (so it gets both new ones).
     - `RoleAssignment.grantSelf({ id, userId, companyId, now })`: `EMPLOYEE` with the colaborador's company, `assignedBy: null`, records `ROLE_ASSIGNED`. `assign` is unchanged.
     - `SessionRepository.revokeAllForUser(userId, now): Promise<number>` (doc: bulk update of non-revoked sessions; used by disable). `RoleAssignmentRepository.countActiveByRole` doc now says "only of ACTIVE users" (README decision 18 note).
     - `errors.ts`: `InvitationNotValidError extends BusinessRuleViolationError` (`INVITATION_NOT_VALID`, "La invitación no es válida o ya expiró"; the same body for unknown, expired, used or superseded tokens, so tokens can't be probed); `EmployeeNotFoundError extends NotFoundError` (`EMPLOYEE_NOT_FOUND`; also used when the employee belongs to another company, so it answers exactly like a missing one); `EmployeeInactiveError extends BusinessRuleViolationError` (`EMPLOYEE_INACTIVE`); `EmployeeAlreadyLinkedError extends ConflictError` (`EMPLOYEE_ALREADY_HAS_ACCESS`); `EmailAlreadyRegisteredError extends ConflictError` (`EMAIL_ALREADY_REGISTERED`).
   - Observable result: typecheck and `pnpm arch:check` pass.

4. **Email infrastructure (shared)**
   - Files: `apps/api/src/shared/application/email.ts` (create), `apps/api/src/shared/application/jobs.ts` (modify), `apps/api/src/infrastructure/queue/bullmq-job-queue.ts` (modify), `apps/api/src/infrastructure/email/smtp-email-sender.ts` (create), `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify), `apps/api/package.json` (modify), `pnpm-lock.yaml` (modify), `apps/api/src/container.ts` (modify), `apps/api/src/shared/testing/fakes.ts` (modify)
   - Do:
     - `email.ts`: `OutgoingEmail { to: string; subject: string; text: string }`, `EmailSender { send(email: OutgoingEmail): Promise<void> }`.
     - `JobQueue.enqueue` options gain `sensitive?: boolean` (doc: payload contains secrets; must not be retained). BullMQ adapter: `sensitive` → `removeOnComplete: true, removeOnFail: true`.
     - Env (Zod, with defaults and Spanish comments): `SMTP_HOST` (`localhost`), `SMTP_PORT` (`1025`), `SMTP_SECURE` (boolean, `false`), `SMTP_USER`/`SMTP_PASSWORD` (optional), `MAIL_FROM` (`RRHH APS <no-reply@example.com>`), `APP_PUBLIC_URL` (url, `http://localhost:3000`), `INVITATION_TTL_HOURS` (`168`). Mirror in `.env.example`.
     - `pnpm --filter @rrhh/api add nodemailer` and `add -D @types/nodemailer`. `SmtpEmailSender` with a lazily created transport (like `bullmq-job-queue.ts:13-16`) and a `close()` disposer.
     - `container.ts`: register `emailSender: asClass(SmtpEmailSender).singleton().disposer(...)` in `SharedCradle`.
     - `fakes.ts`: `RecordingJobQueue` (records `{ name, data, options }`) and `RecordingEmailSender`.
   - Observable result: typecheck; container test green.

5. **Application: invite, activate, disable on termination, email job**
   - Files: `apps/api/src/modules/identity/application/ports/employee-directory.ts` (create), `apps/api/src/modules/identity/application/ports/invitation-tokens.ts` (create), `apps/api/src/modules/identity/application/commands/invite-employee.command.ts` (create), `apps/api/src/modules/identity/application/commands/invite-external.command.ts` (create), `apps/api/src/modules/identity/application/commands/activate-account.command.ts` (create), `apps/api/src/modules/identity/application/commands/disable-terminated-employee.command.ts` (create), `apps/api/src/modules/identity/application/jobs/send-invitation-email.job.ts` (create), `apps/api/src/modules/identity/application/queries/user.queries.ts` (modify), `apps/api/src/modules/identity/application/commands/revoke-role-assignment.command.ts` (modify)
   - Do:
     - `employee-directory.ts`: `InvitableEmployee { id; companyId; email; fullName; active }`, `EmployeeDirectory { find(employeeId): Promise<InvitableEmployee | null> }`.
     - `invitation-tokens.ts`: same shape as `SessionTokens` (`issue()`, `hashOf()`); the adapter can reuse `CryptoSessionTokens`' logic.
     - `SEND_INVITATION_EMAIL = 'identity.send-invitation-email'` job payload `{ to, fullName: string | null, link, expiresAt }`.
     - `InviteEmployee` (input `{ companyId, employeeId, email?: string, invitedBy }`): directory lookup (outside the transaction) → missing or `companyId` mismatch → `EmployeeNotFoundError`; inactive → `EmployeeInactiveError`; `findByEmployeeId` exists → `EmployeeAlreadyLinkedError`; email = input or ficha, `Email.create`; a user with that email → `EmailAlreadyRegisteredError`. Then in `transactionRunner.run`: supersede pending invitations for this employee **and** for this email, issue the new one (`ttlMs` from `INVITATION_TTL_HOURS`), save. After commit: publish events, `jobQueue.enqueue(SEND_INVITATION_EMAIL, { to, fullName, link: `${APP_PUBLIC_URL}/activar?token=${token}`, expiresAt }, { sensitive: true })`. Returns `{ id, email, expiresAt }`.
     - `InviteExternal` (input `{ email, invitedBy }`): same without employee (no link, `companyId: null`).
     - `ActivateAccount` (input `{ token, password }`): `checkPasswordPolicy` first; `findByTokenHash(hashOf(token))`; not pending → `InvitationNotValidError`; email already registered → `EmailAlreadyRegisteredError`; if `employeeId`: re-check the employee is still active (else `InvitationNotValidError`) and not linked. In one transaction: `User.register({ …, employeeId })`, `invitation.accept`, and if linked `RoleAssignment.grantSelf` with the employee's company; saves. Publish after. No session is created (the user logs in normally).
     - `DisableTerminatedEmployee` (input `{ employeeId }`): `findByEmployeeId` → none: `ok` (no-op); `user.disable(now)`, save, `sessionRepository.revokeAllForUser`, supersede pending invitations for the employee. Idempotent.
     - `SendInvitationEmail` job handler: builds a Spanish plain-text email (who invited is not needed; name, link, expiry date) and calls `emailSender.send`. Never logs the link.
     - `RevokeRoleAssignment`: the last-admin count now ignores disabled users (repository change in step 7).
     - `UserQueries.findSessionUser` returns `employeeId`.
   - Observable result: typecheck and `pnpm arch:check` pass.

6. **Module wiring: routes, subscription, job**
   - Files: `apps/api/src/modules/identity/http/invitation.router.ts` (create), `apps/api/src/modules/identity/identity.module.ts` (modify), `apps/api/src/modules/identity/index.ts` (modify), `apps/api/src/modules/identity/infrastructure/employees-employee-directory.ts` (create), `apps/api/src/modules/identity/infrastructure/crypto-invitation-tokens.ts` (create)
   - Do: router maps the three routes (`invitedBy: requireActor(ctx).userId`); mount it with the existing identity routers. Register `invitationRepository`, `employeeDirectory` (adapter over `EmployeesApi`, like `organization-company-directory.ts`), `invitationTokens`, `invitationPolicy` (ttl from env, `APP_PUBLIC_URL`), the four commands. `subscribe: ({ eventBus, disableTerminatedEmployee }) => eventBus.subscribe(EMPLOYEE_TERMINATED, (event) => …)` reading `employeeId` from the payload defensively (unknown shape → log and ignore). `jobs: (cradle) => [cradle.sendInvitationEmail]`.
   - Observable result: `tests/container.test.ts` green; the worker lists `identity.send-invitation-email` on start.

7. **Persistence and migration**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/<timestamp>_create_invitations/migration.sql` (create), `apps/api/src/modules/identity/infrastructure/invitation.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-invitation.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-invitation.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/user.mapper.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-user.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-role-assignment.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-role-assignment.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-user.queries.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.queries.ts` (modify)
   - Do (skill `db-change`): `User.employeeId String? @unique @map("employee_id") @db.Uuid /// referencia por id a employees, sin FK (ADR 0010)`; `model Invitation { id; email VarChar(254); employeeId String? @map("employee_id") @db.Uuid; companyId String? @map("company_id") @db.Uuid; tokenHash String @unique @map("token_hash") @db.Char(64); invitedBy String @map("invited_by") @db.Uuid; createdAt; expiresAt; acceptedAt?; revokedAt?; @@index([employeeId]) @@index([email]) @@map("invitations") @@schema("identity") }` (no FK to other schemas; `invitedBy` references `users` inside the module — FK allowed). `pnpm db:migrate --name create_invitations` (plain columns/indexes only — no hand-written SQL), `pnpm db:generate`; replace `<timestamp>` here and record it in Deviations. `revokeAllForUser` = `updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })`. `countActiveByRole` joins `user: { status: 'ACTIVE' }`. In-memory counterparts.
   - Observable result: migration adds the column, unique index and table, no DROP; `pnpm test:integration` green.

8. **Seed, tests harness, docs**
   - Files: `apps/api/tests/test-app.ts` (modify), `docs/architecture.md` (modify), `plans/identity-acceso/README.md` (modify)
   - Do: `test-app.ts` registers `jobQueue: RecordingJobQueue`, `emailSender: RecordingEmailSender`, in-memory invitation repository and a fake `employeeDirectory` over the in-memory employee repository. `architecture.md`: first event subscription (identity ← `employees.employee.terminated`) and the sensitive-job rule. README: plan 003/005 rows (already added at planning time — only adjust if needed).
   - Observable result: `pnpm check` green.

9. **Test files of this plan** (declared for `pnpm plans:scope`; written by the tester)
   - Files: `packages/contracts/src/identity/invitation.contract.test.ts` (create), `apps/api/src/modules/identity/domain/invitation.test.ts` (create), `apps/api/src/modules/identity/domain/user.test.ts` (modify), `apps/api/src/modules/identity/domain/role-assignment.test.ts` (modify), `apps/api/src/modules/identity/application/commands/invite-employee.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/invite-external.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/activate-account.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/disable-terminated-employee.command.test.ts` (create), `apps/api/src/modules/identity/application/jobs/send-invitation-email.job.test.ts` (create), `apps/api/src/modules/identity/application/commands/revoke-role-assignment.command.test.ts` (modify), `apps/api/tests/invitations.test.ts` (create), `apps/api/tests/integration/identity/prisma-invitation.int.test.ts` (create), `apps/api/tests/integration/identity/prisma-user.int.test.ts` (modify), `apps/api/tests/integration/identity/prisma-session.int.test.ts` (modify), `apps/api/tests/integration/identity/prisma-role-assignment.int.test.ts` (modify)
   - Do: nothing for the implementer.
   - Observable result: suites green.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass; web and mobile typecheck.
- [ ] Migration `*_create_invitations` adds `users.employee_id` (unique, nullable, no FK) and `identity.invitations`; no DROP.
- [ ] HR of company A: `POST /companies/A/employees/:id/invitations` → 201 `{ id, email, expiresAt }` (email = ficha's by default, or the one sent); for company B → 403; employee of another company or unknown → 404 `EMPLOYEE_NOT_FOUND`; terminated employee → 422 `EMPLOYEE_INACTIVE`; already linked → 409 `EMPLOYEE_ALREADY_HAS_ACCESS`; email already registered → 409 `EMAIL_ALREADY_REGISTERED`.
- [ ] Inviting again supersedes the previous invitation: the old token no longer activates.
- [ ] `POST /invitations` (external): Admin holding → 201; HR → 403.
- [ ] With `pnpm dev:api` + `pnpm dev:worker` + Mailpit, the invitation email arrives in Mailpit (http://localhost:8025) with the activation link; the job does not remain in Valkey after completion.
- [ ] `POST /auth/activate` with the token and a valid password → 204; login then works; `/auth/me` returns `employeeId`; the new user has exactly one active `EMPLOYEE` assignment with the colaborador's company; a second activation with the same token, an expired, superseded or unknown token → 422 `INVITATION_NOT_VALID` (same body); weak password → 422 `WEAK_PASSWORD`.
- [ ] External activation creates a user with `employeeId: null` and no role.
- [ ] Publishing `employees.employee.terminated` for a linked colaborador disables the user, revokes all their sessions (next request 401) and supersedes pending invitations — **checked by tests** (no terminate endpoint exists yet; see Out of scope).
- [ ] The last-admin rule ignores disabled admins.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | yes     | `Invitation` lifecycle (pending/expired/accepted/superseded), `User.disable` idempotence, `grantSelf`                                                        |
| application | yes     | every branch of `InviteEmployee`, `InviteExternal`, `ActivateAccount`, `DisableTerminatedEmployee`; sensitive enqueue; email job content (no secrets logged) |
| contract    | yes     | new routes' access and shapes; `employeeId` in `SessionUser`; OpenAPI snapshot                                                                               |
| http        | yes     | invite matrix per role and company, supersede, activate → login → `/auth/me`, token reuse, termination event → 401                                           |
| integration | yes     | Prisma invitation repository, `employee_id` uniqueness, `revokeAllForUser`, last-admin count ignoring disabled users                                         |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                  |

## Deviations

Cosmetic, fixed forward (none changes design or scope):

- **Migration timestamp** (step 7): `20260930165402_create_invitations` (generated with `prisma migrate dev` under a pty, because the warning for the new unique index asks for interactive confirmation; SQL has no DROP and no hand-written statements). `invitations.invited_by` is a plain column (no FK), as in the plan's schema text.
- **Existing tests outside the plan's file list, updated minimally** because the planned behavior changes their expectations (`pnpm plans:scope` reports them as out of scope):
  - `packages/contracts/src/openapi.test.ts` (operation count 12 → 15), `packages/contracts/src/identity/access.contract.test.ts` (public routes now include `invitations.activateAccount`), `packages/contracts/src/identity/auth.contract.test.ts` (`SessionUser` fixture gains `employeeId`).
  - `apps/api/src/modules/identity/application/commands/log-in.command.test.ts`, `.../queries/get-current-user.query.test.ts`, `.../application/session-authenticator.test.ts` (fixtures/expectations gain `employeeId: null`; HR now has 4 grants), `.../domain/role-catalog.test.ts` (HR gains `identity.users:invite`), `apps/api/tests/auth.test.ts` (`/auth/me` returns `employeeId`).
  - `.../application/commands/revoke-role-assignment.command.test.ts` (listed in step 9 as "modify"; the admins are now registered as ACTIVE users in the in-memory store because the last-admin count ignores users not ACTIVE) and `.../domain/user.test.ts` (listed; `employeeId: null` in `UserProps` fixtures) — only the minimum to keep the build green; the tester adds the new cases.
- `apps/api/src/modules/identity/application/commands/log-in.command.ts` (not listed): `LogInOutput.user` and its mapping gain `employeeId`, forced by `SessionUserSchema` (the login response reuses it).
- Listed but unchanged: `application/queries/user.queries.ts` (its type derives from `SessionUser`; only the Prisma/in-memory adapters changed) and `application/commands/revoke-role-assignment.command.ts` (the repository change is enough). `identity/index.ts` only gained the new event-name exports.
- `DisableTerminatedEmployee` runs its writes inside `transactionRunner.run` (not spelled out in the plan) so disable + session revoke + invitation supersede are atomic.
- Unknown payload in the `EMPLOYEE_TERMINATED` subscription throws inside the handler: `InMemoryEventBus` already logs rejected handlers (`event handler failed`) and continues, which implements "log and ignore" without needing a logger in the module cradle.

Risk for the tester (NOT CONFIRMED): `PrismaUserRepository.save` tells `employee_id` uniqueness from `email` uniqueness by looking for `employee_id` in the P2002 error's `meta` (Prisma 7 + `@prisma/adapter-pg`); confirm it against the real DB in `prisma-user.int.test.ts`.

## Test coverage

## Review findings

## Verification
