---
status: review
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
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20260930165402_create_invitations/migration.sql` (create), `apps/api/src/modules/identity/infrastructure/invitation.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-invitation.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-invitation.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/user.mapper.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-user.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-role-assignment.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-role-assignment.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-user.queries.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.queries.ts` (modify)
   - Do (skill `db-change`): `User.employeeId String? @unique @map("employee_id") @db.Uuid /// referencia por id a employees, sin FK (ADR 0010)`; `model Invitation { id; email VarChar(254); employeeId String? @map("employee_id") @db.Uuid; companyId String? @map("company_id") @db.Uuid; tokenHash String @unique @map("token_hash") @db.Char(64); invitedBy String @map("invited_by") @db.Uuid; createdAt; expiresAt; acceptedAt?; revokedAt?; @@index([employeeId]) @@index([email]) @@map("invitations") @@schema("identity") }` (no FK to other schemas; `invitedBy` references `users` inside the module — FK allowed). `pnpm db:migrate --name create_invitations` (plain columns/indexes only — no hand-written SQL), `pnpm db:generate`; replace `<timestamp>` here and record it in Deviations. `revokeAllForUser` = `updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } })`. `countActiveByRole` joins `user: { status: 'ACTIVE' }`. In-memory counterparts.
   - Observable result: migration adds the column, unique index and table, no DROP; `pnpm test:integration` green.

8. **Seed, tests harness, docs**
   - Files: `apps/api/tests/test-app.ts` (modify), `docs/architecture.md` (modify), `plans/identity-acceso/README.md` (modify), and, added during implementation (see Deviations): `apps/api/src/modules/identity/application/commands/log-in.command.ts` (modify), `apps/api/src/modules/identity/application/commands/log-in.command.test.ts` (modify), `apps/api/src/modules/identity/application/queries/get-current-user.query.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify), `apps/api/tests/auth.test.ts` (modify), `packages/contracts/src/identity/access.contract.test.ts` (modify), `packages/contracts/src/identity/auth.contract.test.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify)
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

**Repair round 1 (review M1, L2, L1; L3 deferred to `plans/hallazgos/identity-invitaciones-concurrentes.md`):**

- **M1**: `InvitationRepository.save` now returns `boolean`. `PrismaInvitationRepository.save` is conditional (`updateMany WHERE id AND accepted_at IS NULL AND revoked_at IS NULL`, else `create` if absent, else `false`), so an already accepted or superseded invitation is never overwritten. `ActivateAccount` throws an internal `InvitationLostError` inside the transaction when `save` returns `false` (rolls back the created `User`/role) and maps it to `InvitationNotValidError`.
- **L2**: `DisableTerminatedEmployee` now supersedes the employee's pending invitations first, even when no `User` exists, and then looks up the user, all inside one transaction (so one of the two racing transactions always sees the other). Returns `ok` without events if there is no account.
- Test updated minimally so `pnpm check` stays green: the no-op test in `disable-terminated-employee.command.test.ts` now asserts the pending invitation is superseded. The tester adds the regressions (conditional accept in integration, activation losing the race, repository `false` path).
- **L1**: step 7 timestamp replaced; the nine test/fixture files and `log-in.command.ts` added to step 9's file list. Residual `plans:scope` output: the two "declared without changes" entries (recorded above).

**Repair round 2 (review round 2 L4, L5; main session inline, user decision 2026-09-30):**

- **L4**: `InMemoryInvitationRepository` now stores and returns copies (`Invitation.restore` of the snapshot, the pattern of `InMemorySessionRepository`) and `save` returns `false` without writing when the stored invitation is already accepted or superseded, like the Prisma adapter.
- **L5**: docblock of `DisableTerminatedEmployee` rewritten (duplicated "y", line length).

Risk for the tester (NOT CONFIRMED): `PrismaUserRepository.save` tells `employee_id` uniqueness from `email` uniqueness by looking for `employee_id` in the P2002 error's `meta` (Prisma 7 + `@prisma/adapter-pg`); confirm it against the real DB in `prisma-user.int.test.ts`.

## Test coverage

Tester run (2026-09-30). Baseline: `pnpm check` and `pnpm test:integration` green before writing anything (api 311 unit/http tests, 59 integration). No GAP found: every behavior the plan promises is implemented and confirmed by execution. Two items need external services and are marked NOT CONFIRMED (`it.skip`). The Deviations risk (P2002 `meta` containing `employee_id`) is CONFIRMED against the real test DB.

Counts of tests added by this phase: domain 18, application 45, contract 21, http 35 (+2 skipped), integration 21.

| Behavior (plan / code)                                                                            | Source                                                   | Layer       | Test                                                                                                       | State                                     |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Invitation lifecycle: pending until `expiresAt` (exclusive), accept, supersede no-op              | `domain/invitation.ts:68-92`                             | domain      | `invitation.test.ts` (issue / isPendingAt / accept / supersede / restore)                                  | CONFIRMED                                 |
| `INVITATION_ISSUED` / `INVITATION_ACCEPTED` events; payload carries no token hash                 | `invitation.ts:57-66,78-83`                              | domain      | `invitation.test.ts › nace pendiente…`, `› pendiente: queda aceptada…`                                     | CONFIRMED                                 |
| `User.register` with/without `employeeId`; `disable` idempotent, `USER_DISABLED`                  | `domain/user.ts:32-57`                                   | domain      | `user.test.ts › register sin employeeId…`, `disable`                                                       | CONFIRMED                                 |
| `RoleAssignment.grantSelf` (EMPLOYEE, company, assignedBy null); `assign` still rejects           | `domain/role-assignment.ts:79-110`                       | domain      | `role-assignment.test.ts › grantSelf`                                                                      | CONFIRMED                                 |
| InviteEmployee: happy path, ficha email vs edited email, all error branches                       | `invite-employee.command.ts`                             | application | `invite-employee.command.test.ts` (16)                                                                     | CONFIRMED                                 |
| Foreign-company employee answers like a missing one (same message)                                | `invite-employee.command.ts:72-75`                       | application | `› colaborador de otra empresa responde igual…`                                                            | CONFIRMED                                 |
| Supersede pending by employee and by email; expired ones untouched                                | `invite-employee.command.ts:98-110`                      | application | `› invitar de nuevo reemplaza…`, `› otro correo…`, `› mismo correo de otro colaborador…`, `› ya expirada…` | CONFIRMED                                 |
| Email job enqueued `sensitive: true`, link `/activar?token=`, token stored only hashed            | `invite-employee.command.ts:114-124`                     | application | `› encola el correo como sensitive…`                                                                       | CONFIRMED                                 |
| InviteExternal: no employee/company, sensitive job, invalid/registered email, supersede           | `invite-external.command.ts`                             | application | `invite-external.command.test.ts` (5)                                                                      | CONFIRMED                                 |
| ActivateAccount: linked (user + accept + EMPLOYEE role), external (no role), hash only            | `activate-account.command.ts:62-118`                     | application | `activate-account.command.test.ts` (first 3)                                                               | CONFIRMED                                 |
| ActivateAccount: weak password, unknown / used / expired / superseded token, same body            | `activate-account.command.ts:70-76`, `errors.ts`         | application | `activate-account.command.test.ts` (WEAK_PASSWORD … mismo cuerpo)                                          | CONFIRMED                                 |
| ActivateAccount: email registered meanwhile, employee terminated meanwhile, already linked        | `activate-account.command.ts:78-83,122-133`              | application | `activate-account.command.test.ts` (last 4)                                                                | CONFIRMED                                 |
| DisableTerminatedEmployee: disable, revoke all sessions, supersede invitations, no-op, idempotent | `disable-terminated-employee.command.ts`                 | application | `disable-terminated-employee.command.test.ts` (5)                                                          | CONFIRMED                                 |
| Email job content in Spanish (name/link/expiry), generic greeting, failure propagates             | `send-invitation-email.job.ts:26-48`                     | application | `send-invitation-email.job.test.ts` (4)                                                                    | CONFIRMED                                 |
| Job never logs the link                                                                           | `send-invitation-email.job.ts` (deps only `emailSender`) | application | none: the handler has no logger dependency, nothing observable to assert without testing source text       | NOT TESTED (by construction, see note)    |
| Last-admin count ignores DISABLED users                                                           | `in-memory-role-assignment.repository.ts:32-40`          | application | `revoke-role-assignment.command.test.ts › un HOLDING_ADMIN de un usuario DISABLED…`                        | CONFIRMED                                 |
| New routes: method, path, status, access, `companyParam`; public activate                         | `invitation.contract.ts`                                 | contract    | `invitation.contract.test.ts › invitationRoutes…`                                                          | CONFIRMED                                 |
| Schemas: optional/required email, token/password length, no password policy in schema             | `invitation.contract.ts:5-24`                            | contract    | `invitation.contract.test.ts` (schemas)                                                                    | CONFIRMED                                 |
| Response has no token field; `SessionUser.employeeId` nullable uuid                               | `invitation.contract.ts:7`, `auth.contract.ts`           | contract    | `invitation.contract.test.ts › InvitationSchema`, `› SessionUserSchema.employeeId`                         | CONFIRMED                                 |
| OpenAPI snapshot up to date                                                                       | `packages/contracts/openapi.json`                        | contract    | existing `openapi.test.ts › openapi.json está al día…`                                                     | CONFIRMED                                 |
| Invite matrix: HR A 201, HR B / other path 403, anon 401, no role 403, admin 201                  | `invitation.router.ts`, `access.ts`                      | http        | `invitations.test.ts › POST /companies/:companyId/employees/:employeeId/invitations`                       | CONFIRMED                                 |
| 404 foreign/unknown (same body), 422 inactive, 409 linked, 409 email, 400 validation              | `invite-employee.command.ts`, `bind-route.ts`            | http        | same describe                                                                                              | CONFIRMED                                 |
| Re-invite supersedes: old token 422, new token 204                                                | `invite-employee.command.ts`                             | http        | `› invitar de nuevo reemplaza a la anterior…`                                                              | CONFIRMED                                 |
| External: admin 201, HR 403, anon 401, email registered 409, bad body 400                         | `invitation.contract.ts:39-47`                           | http        | `invitations.test.ts › POST /invitations (externa)`                                                        | CONFIRMED                                 |
| Activate → login → `/auth/me` employeeId; one EMPLOYEE assignment; no session on activate         | `activate-account.command.ts`                            | http        | `invitations.test.ts › POST /auth/activate`                                                                | CONFIRMED                                 |
| EMPLOYEE grants no permission (403 on employees list); external user has no role                  | `role-catalog.ts`                                        | http        | `› la cuenta EMPLOYEE no concede permisos…`, `› invitación externa…`                                       | CONFIRMED                                 |
| Token reuse / unknown / superseded / expired → same 422; weak password keeps token                | `errors.ts`, `activate-account.command.ts`               | http        | `› segundo uso…`, `› token desconocido, usado y reemplazado…`, `› token expirado…`, `› contraseña débil…`  | CONFIRMED                                 |
| Termination event → session 401, login 401 (same as wrong password), user DISABLED                | `identity.module.ts:118-128`, `disable-terminated-…`     | http        | `invitations.test.ts › baja del colaborador…`                                                              | CONFIRMED                                 |
| Unknown event payload is ignored without failing the publish                                      | `identity.module.ts:120-124`, `in-memory-event-bus.ts`   | http        | `› un evento con payload desconocido se ignora…`                                                           | CONFIRMED                                 |
| Invitation repository: roundtrip, unique token hash, pending filters, upsert                      | `prisma-invitation.repository.ts`                        | integration | `prisma-invitation.int.test.ts` (9)                                                                        | CONFIRMED                                 |
| `users.employee_id` unique; nulls coexist; P2002 meta distinguishes employee vs email             | `prisma-user.repository.ts:13-17,47-56`                  | integration | `prisma-user.int.test.ts › vínculo con el colaborador`                                                     | CONFIRMED (risk from Deviations resolved) |
| `revokeAllForUser`: closes open, other users untouched, keeps earlier marks, count                | `prisma-session.repository.ts:31-37`                     | integration | `prisma-session.int.test.ts › revokeAllForUser`                                                            | CONFIRMED                                 |
| `countActiveByRole` ignores DISABLED users; `grantSelf` persisted                                 | `prisma-role-assignment.repository.ts:27-31`             | integration | `prisma-role-assignment.int.test.ts` (2 new)                                                               | CONFIRMED                                 |
| `sensitive` enqueue → BullMQ `removeOnComplete/removeOnFail: true`                                | `bullmq-job-queue.ts`                                    | http (skip) | `invitations.test.ts › it.skip('NOT CONFIRMED: …Valkey')`                                                  | NOT CONFIRMED                             |
| SMTP delivery to Mailpit with the activation link                                                 | `smtp-email-sender.ts`                                   | http (skip) | `invitations.test.ts › it.skip('NOT CONFIRMED: …SMTP')`                                                    | NOT CONFIRMED                             |

**Repair round 1 regressions (tester, 2026-09-30).** Baseline: `pnpm check` and `pnpm test:integration` green (api 409 + 2 skipped, 80 integration). The previous matrix rows remain valid except the no-op row of `DisableTerminatedEmployee`, superseded by the L2 row below.

| Behavior (repair M1 / L2)                                                                                 | Source                                         | Layer       | Test                                                                                                             | State     |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------- | --------- |
| `save` returns true on create and on updating a still-pending invitation                                  | `prisma-invitation.repository.ts:37-52`        | integration | `prisma-invitation.int.test.ts › save condicional › devuelve true…`                                              | CONFIRMED |
| Accepted invitation in DB is never overwritten by a stale supersede (returns false, marks intact)         | `prisma-invitation.repository.ts:40-47`        | integration | `› una invitación ya aceptada en la base no se sobrescribe…`                                                     | CONFIRMED |
| Superseded invitation in DB is never revived by a stale accept (returns false, marks intact)              | same                                           | integration | `› una invitación ya reemplazada en la base no se revive…`                                                       | CONFIRMED |
| Concurrent accept vs supersede: exactly one write wins, row keeps one mark                                | same                                           | integration | `› aceptar y reemplazar a la vez…` (Promise.all against the real DB)                                             | CONFIRMED |
| Activation losing the race at commit: `INVITATION_NOT_VALID`, transaction rolled back, no role, no events | `activate-account.command.ts:98-112`           | application | `activate-account.command.test.ts › la invitación fue cerrada entre la lectura y el commit…`                     | CONFIRMED |
| Termination of a colaborador without account supersedes the pending invitation, ok, no events (L2)        | `disable-terminated-employee.command.ts:38-48` | application | `disable-terminated-employee.command.test.ts › colaborador sin cuenta…` (updated by the implementer, kept as is) | CONFIRMED |

Not covered by design: the real interleaving of activation vs `DisableTerminatedEmployee` across two transactions (needs a controllable DB interleaving); the integration test above exercises the conditional write that makes it safe, and the application test the handling of `false`. The rollback of the created `User` is asserted through the runner seeing the thrown error (the in-memory repositories have no rollback), not by absence of the row.

**Repair round 2 (L4, main session inline, 2026-09-30).** With the fake returning copies, seven application tests that asserted on the object they had seeded or read before the command (aliasing) now re-read the stored invitation from the repository after the command: `activate-account` (1), `disable-terminated-employee` (2), `invite-employee` (3), `invite-external` (1). The race test in `activate-account.command.test.ts` replaces the `LosingInvitationRepository` stub (always `false`) with `RacingInvitationRepository`, which supersedes the stored invitation right after the activation reads it, so the fake's real guard produces the `false`; it also asserts the stored invitation stays superseded and not accepted. `pnpm check` green (api 410 + 2 skipped).

Notes for review/verify: the two NOT CONFIRMED items are exactly the acceptance criterion "email arrives in Mailpit; the job does not remain in Valkey", which the verifier must exercise in the running app. Existing test files outside the plan's step 9 list were touched by the implementer (see Deviations), not by the tester.

## Review findings

Reviewer run (2026-09-30), diff `a19aa6d..HEAD` (commits 0344fd9, 2d25090, a2e9a86), working tree clean.

### Pass 1 — Checklist: 12/13

- [ ] `pnpm plans:scope` — **FAIL** (exit 1). 9 files out of scope (the test/fixture files and `log-in.command.ts` listed in Deviations) and 3 "declared without changes" (`user.queries.ts`, `revoke-role-assignment.command.ts`, and the literal `apps/api/prisma/migrations/<timestamp>_create_invitations/migration.sql`, because step 7's `<timestamp>` was never replaced as step 7 instructs). All are recorded honestly in Deviations, and the hot-file changes (`schema.prisma`, `container.ts`, `test-app.ts`, `contracts/src/index.ts`) are append-only. So this is a gap in the plan text only (see L1), not in the code.
- [x] `pnpm check` green (api 409 passed + 2 skipped, contracts 107, domain 51; arch, plans lint, harness, hooks all ok).
- [x] `pnpm test:integration` green (9 files, 80 tests).
- [x] Business rules are in `domain/` (`Invitation`, `User.disable`, `RoleAssignment.grantSelf`, role catalog). The router, mappers and adapters contain none.
- [x] CQRS-lite: the commands go aggregate → repository → `Result`. `findSessionUser` goes through `UserQueries`. No screen-specific repository methods.
- [x] Types come from `@rrhh/contracts` (`invitationRoutes`, `SessionUserSchema.employeeId`), with nothing duplicated. The `InvitationIssued` command output matches the contract shape.
- [x] Expected errors use `Result` plus stable codes (`INVITATION_NOT_VALID`, `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_INACTIVE`, `EMPLOYEE_ALREADY_HAS_ACCESS`, `EMAIL_ALREADY_REGISTERED`). Token probing gets one uniform body.
- [x] Time and IDs go through `Clock`/`IdGenerator`. Dates are UTC `timestamptz`. No money involved.
- [x] The migration is new (`20260930165402_create_invitations`). Its SQL is only an ADD COLUMN, a CREATE TABLE and indexes. No DROP and no cross-schema FK.
- [x] DI resolves (`container.test.ts` green). `employeesApi` and the identity registrations each appear once. Importing `EMPLOYEE_TERMINATED` into `identity.module.ts` through `@/modules/employees` (index) is allowed by `.dependency-cruiser.cjs`, which restricts only domain/application/http.
- [x] No secrets. `.env.example` has only empty/default values. Fixtures are synthetic. The job payload is never logged: the worker logs only `job.name`/`jobId`, and pino-http does not log bodies.
- [x] Deviations exist and are honest. Spot-checks: `InMemoryEventBus` does log rejected handlers (`in-memory-event-bus.ts:27-32`, `event handler failed`), and "listed but unchanged" matches the scope output.
- [x] Docs: `docs/architecture.md` covers sensitive jobs and the first cross-module subscription. README rows and decisions 19-22 are added. No stale doc found (ADR 0012's "EMPLOYEE inert" still holds, since EMPLOYEE grants no permission).

### Pass 2 — Findings

**Medium**

- **M1 — Activation racing with a termination can leave a terminated colaborador with an ACTIVE account that is never disabled.**
  - Where: `apps/api/src/modules/identity/application/commands/activate-account.command.ts:73-107` together with `disable-terminated-employee.command.ts:35`.
  - What fails: `ActivateAccount` checks that the employee is active (`:128`, via the directory, outside any lock), then runs argon2 (`:77`, about 100 ms or more), then commits the user, the accepted invitation and the EMPLOYEE role (`:97-107`). If `employees.employee.terminated` is published inside that window, `DisableTerminatedEmployee` runs `findByEmployeeId` → no user yet → returns `ok` at `:35` without doing anything. The activation then commits.
  - Result: an ACTIVE `User` linked to a terminated colaborador, holding an active EMPLOYEE assignment. Nothing ever disables it, because the event was already consumed and there is no re-enable/disable endpoint. This breaks README decision 20 ("disabled at once").
  - Related root cause: the invitation `accept` is persisted with an unconditional upsert (`prisma-invitation.repository.ts:37-44`, full snapshot), so a supersede committed concurrently (by a re-invite or by the baja) is overwritten back to `revokedAt: null` + `acceptedAt`. Nothing at commit time re-validates that the invitation is still pending.
  - Reachability: not reachable over HTTP today, because no terminate command exists (Out of scope). It becomes live as soon as `employees` ships termination. The window includes the password hash, so it is not negligible.
  - Suggested direction (the implementer decides): make acceptance conditional inside the transaction (an update `WHERE id AND accepted_at IS NULL AND revoked_at IS NULL`, or `SELECT … FOR UPDATE` on the invitation, with failure → `InvitationNotValidError`). Also have `DisableTerminatedEmployee` supersede pending invitations for the employee **even when no user exists yet** (see L2), so that one of the two transactions always sees the other.
  - Certainty: confirmed by reading the code; not reproduced by a test (it needs interleaving).

**Low**

- **L1 — The plan's file lists do not match the diff, so `pnpm plans:scope` fails.**
  - Where: plan step 7 (`<timestamp>` still literal) and steps 1/5/9, which lack the 9 files listed in Deviations.
  - Scenario: the scope gate stays red for this plan, and any later phase (repair, verify) cannot use it as a clean signal.
  - Fix (plan text only): replace `<timestamp>` with `20260930165402` in step 7, and add the 9 test/fixture files and `log-in.command.ts` to the file lists as deviation entries.
- **L2 — The "supersede pending invitations" branch of `DisableTerminatedEmployee` is effectively dead, and the case where it matters is skipped.**
  - Where: `disable-terminated-employee.command.ts:35-49`.
  - A linked colaborador cannot normally have a pending invitation: `InviteEmployee` rejects linked employees, and activation accepts the only pending one. An unlinked colaborador with a pending invitation, which is the common "invited, not yet activated" case, returns early at `:35`, so their invitation stays pending. The test `disable-terminated-employee.command.test.ts:134-142` cements this.
  - Today `ActivateAccount` re-checks `active` (`:128`), so the leftover token is rejected and this is not exploitable alone. It does mean the acceptance criterion "supersedes pending invitations" is only met in a state the flows cannot produce, and it is part of what makes M1 possible.
  - The plan's own step 5 text says "none: ok (no-op)", so this is a plan-literal vs. intent mismatch. The fix can go through M1's repair; the tester would then update the no-op test.
- **L3 — Two concurrent `InviteEmployee` calls for the same colaborador (or email) both commit a pending invitation.**
  - Where: `invite-employee.command.ts:98-110` (same pattern in `invite-external.command.ts:73-79`). The supersede is read-then-write with no lock or uniqueness.
  - Scenario: a double-clicked "Invitar" sends two emails with two valid tokens.
  - Impact is contained. The first activation links the account, and the second token then fails with 409 `EMPLOYEE_ALREADY_HAS_ACCESS`, or with `EMAIL_ALREADY_REGISTERED` for an external invitation. There is no duplicate user or role.
  - Informational; fix only if M1's repair adds an invitation lock anyway.

**Notes for the verifier (not findings)**

- The acceptance criterion names `pnpm dev:worker`, but the root `package.json` has no such script. Use `pnpm --filter @rrhh/api dev:worker`.
- The two NOT CONFIRMED items (Mailpit delivery, sensitive job not kept in Valkey) are still for the verifier.

Result: M1 requires a code change, so the status stays `review` (back to implementing via the main session). Count: 0 high, 1 medium, 3 low.

### Repair decision (2026-09-30, user)

- Fix in this plan: **M1**, **L2** (supersede pending invitations of the employee even when no user exists; one of the two transactions must always see the other) and **L1** (plan file lists: step 7 timestamp and the files recorded in Deviations).
- **L3** is deferred to `plans/hallazgos/identity-invitaciones-concurrentes.md` (impact contained; not fixed here unless M1's repair adds an invitation lock anyway).
- Circuit: review → implementing (implementer repairs) → testing (tester adds regressions and updates the L2 no-op test) → review (round 2) → verify.

### Round 2 (2026-09-30) — repair of M1, L2, L1

Reviewer run, diff `4418fd7..HEAD` (commits b1fff1b fix, 37a7c86 test), working tree clean. Round 1 findings above are kept as history; M1, L2 and L1 are superseded by this round, and L3 is tracked in `plans/hallazgos/identity-invitaciones-concurrentes.md`.

**Pass 1 — Checklist: 13/13**

- [x] `pnpm plans:scope` passes (82 declared, 82 changed). What remains is the two "declared without changes" entries recorded in Deviations, plus the four append-only hot files. **L1 resolved.**
- [x] `pnpm check` green: api 410 passed + 2 skipped, contracts 107, domain 51; arch, plans lint, harness, hooks and quality all ok.
- [x] `pnpm test:integration` green (9 files, 84 tests; 4 of them new, in `prisma-invitation.int.test.ts › save condicional`).
- [x] Business rules stay in the domain: `Invitation.accept`/`supersede` are unchanged. The conditional write is a persistence guarantee documented on the port (`invitation.repository.ts:11-16`).
- [x] CQRS-lite unchanged. `save` returning `boolean` is a write outcome, not a screen method.
- [x] No contract changes.
- [x] Expected errors: the lost race maps to the existing `INVITATION_NOT_VALID`. `InvitationLostError` is internal (not exported) and only serves to roll back the transaction; anything else is rethrown (`activate-account.command.ts:117-122`).
- [x] Time and IDs unchanged (`clock.now()` is still taken once per command).
- [x] No new migration. The conditional update uses existing columns.
- [x] DI: no new registrations, and `container.test.ts` is green.
- [x] No secrets and no real data. The new fixtures are synthetic.
- [x] Deviations are honest. Spot-check: "L2 … all inside one transaction" matches `disable-terminated-employee.command.ts:35-52` (supersede, then `findByEmployeeId`, then disable and revoke, all inside `transactionRunner.run`).
- [x] Docs: nothing stale. The port docblock describes the new `save` semantics.

**Pass 2 — Findings**

Traced interleavings (Postgres default READ COMMITTED; `PrismaDatabase` propagates the tx client via AsyncLocalStorage, so the repository `client` is the transaction's). T1 = `ActivateAccount` (INSERT user, then conditional UPDATE invitation). T2 = `DisableTerminatedEmployee` (conditional UPDATE invitation, then SELECT user).

- (a) T2 updates the invitation first. T1's UPDATE blocks on the row lock and re-evaluates `revoked_at IS NULL` after T2 commits: 0 rows, `findUnique` finds the row, `false`, `InvitationLostError`, and T1's user insert is rolled back.
- (b) T1 updates first. T2's UPDATE blocks, then matches 0 rows (`accepted_at` is set). Its next statement (`findByEmployeeId`) sees T1's committed user and disables it.
- (c) T1 commits before T2 starts. T2 finds no pending invitation, finds the user and disables it.

No interleaving leaves an ACTIVE user for a terminated colaborador. The lock order (users index, then invitation row, versus invitation row then a plain read) cannot deadlock. Two concurrent activations of the same token still collide on the email unique index and get 409, as before. **M1 resolved. L2 resolved** (`disable-terminated-employee.command.ts:38-45`: invitations are superseded even without an account, and the test asserts `revokedAt`).

**Low (non-blocking)**

- **L4 — The in-memory invitation repository does not honor the port's new contract.**
  - Where: `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-invitation.repository.ts:37-40`.
  - What fails: `save` always stores the value and returns `true`. The port (`invitation.repository.ts:11-16`) promises that an invitation already accepted or superseded is never overwritten and that `save` returns `false` in that case. By contrast, `InMemoryUserRepository.save` does emulate the DB's unique constraints.
  - Why it is non-blocking today:
    - The fake stores live references, so `findById`/`findByTokenHash`/`findPending*` return the stored object itself, and a stale copy cannot exist unless a test builds one with `Invitation.restore`.
    - Every current caller saves only an instance it has just seen pending (`findPending*` results, or `accept()` success), so in sequential flows both adapters return `true`. No current unit or http test would behave differently on Prisma.
    - The `false` branch is covered by the `LosingInvitationRepository` subclass (application) and by 4 integration tests against the real DB.
  - Failure scenario (latent): a future caller or http test that relies on `false` (for example, a stale accept after a supersede) would pass against the fake and behave differently in production, and the gap would only show up in integration. Two options: make the fake store snapshots (restore on read) and apply the same `acceptedAt/revokedAt` guard, or add a comment on the fake stating that it does not emulate the conditional write and why. Decision for the main session/user; not required for this plan.
- **L5 — Docblock typo.** `disable-terminated-employee.command.ts:25` reads "Idempotente (el evento puede repetirse) y y reemplaza…" (duplicated "y"; the line is also longer than the 100-column style of its neighbours, since Prettier does not wrap comments). Cosmetic; fix forward.
- Informational, not a finding: `InviteEmployee`/`InviteExternal`/`DisableTerminatedEmployee` ignore the `boolean` from `save` on supersede. This is correct: `false` there means the invitation was concurrently accepted or superseded, which is the desired end state anyway. The pending-invitation duplication stays under L3's hallazgo.

Result: M1, L2 and L1 are resolved. The two new lows need no code change for this plan. Count for round 2: 0 high, 0 medium, 2 low (non-blocking). Status → `verify`.

**Repair decision (2026-09-30, user):** fix L4 and L5 before verifying. Repaired inline by the main session (see Deviations › Repair round 2); status verify → implementing → testing → review for a short round 3.

## Verification
