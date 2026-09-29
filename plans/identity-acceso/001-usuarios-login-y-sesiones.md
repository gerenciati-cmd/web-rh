---
status: testing
module: identity
min_implementer: mid
depends_on: []
---

# 001 — Módulo identity: usuarios, login y sesiones

## Context

**Today.** There is no authentication anywhere in the API. `createApp` mounts every module router
under `/api/v1` with no auth step (`apps/api/src/http/app.ts:43-47`); CORS already allows
credentials (`apps/api/src/http/app.ts:22`). Route handlers only receive the parsed
`params/query/body` (`apps/api/src/http/bind-route.ts:8-10,24-31`), so nothing can know who is
calling. The error handler maps domain error _categories_ to status codes via a table
(`apps/api/src/http/error-handler.ts:19-27`) and treats adapter errors like
`RequestValidationError` separately (`apps/api/src/http/error-handler.ts:35-43`,
`apps/api/src/http/request-validation-error.ts:3-14`). Domain categories live in the shared kernel
(`packages/domain/src/errors.ts:17-33`); there is none for 401 or 429. `@rrhh/api-client` already
sends `Authorization: Bearer` when given `getAccessToken` (`packages/api-client/src/client.ts:17,64-71`).
The `identity` module is registered as `planned` in `docs/harness/modules.json` with the summary
"access + refresh tokens", and `docs/architecture.md:131` anticipates JWT access + refresh
tokens — both superseded by README decision 4. Express has no cookie parser installed
(`apps/api/package.json:20-33`). Node ≥ 24.7 ships `crypto.argon2` (`@types/node` 26.6.3,
`crypto.d.ts:3488-3495`, `@since v24.7.0`); the repo allows Node `>=24`
(`package.json:6-7`), Docker uses `node:24` (`apps/api/Dockerfile:10`) and local is v24.16.
Env config is a Zod schema with defaults (`apps/api/src/config/env.ts:9-34`). The dev seed goes
through use cases, reading them from the container cradle (`apps/api/prisma/seed.ts:1-14`).

**What we need.** Plan 001 of `plans/identity-acceso/README.md`: users with argon2id passwords,
login/logout/me, opaque server-side sessions in `identity.sessions` (README decision 4) with the
lifetimes of decision 5, login throttling, and a request-scoped `Actor` handed to every route
handler so plan 002 can enforce permissions. No endpoint is protected yet except `logout`/`me`;
no user can be created over HTTP (only by the dev seed) — README dependency notes.

**Approach.** Compared (a) JWT access + refresh and (b) opaque session tokens stored hashed in
Postgres; the user chose (b) (README decisions 4, "Considered and discarded"). Authentication is
a global middleware in `src/http/` that resolves the token (Bearer header, else cookie) through a
shared port `RequestAuthenticator` implemented by the identity module, and `bindRoute` passes a
`RequestContext` (actor, client ip/user-agent, cookie jar) as a second handler argument, so
existing handlers keep compiling unchanged. Throttling is a small domain entity persisted in
Postgres (same durability argument as decision 4). User and session ids are UUID v7 via
`IdGenerator`; token randomness and hashing are behind ports (AGENTS.md "Tiempo y azar").

**Imitated files.** Aggregate: `apps/api/src/modules/employees/domain/employee.ts:36-108`
(private constructor, static factory returning `Result`, `restore`, `snapshot`, events).
Repository port: `apps/api/src/modules/employees/domain/employee.repository.ts:6-11`. Errors:
`apps/api/src/modules/employees/domain/errors.ts:1-25`. Command:
`apps/api/src/modules/employees/application/commands/register-employee.command.ts:15-72`.
Query port + use case: `apps/api/src/modules/employees/application/queries/employee.queries.ts:1-12`,
`list-employees.query.ts:1-13`. Prisma repository with `isUniqueViolation`:
`apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:12-47`. Mapper:
`apps/api/src/modules/employees/infrastructure/employee.mapper.ts:7-44`. Prisma queries:
`apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts:12-19`. In-memory repo:
`apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts:7-35`.
Router: `apps/api/src/modules/employees/http/employees.router.ts:1-24`. Module:
`apps/api/src/modules/employees/employees.module.ts:15-33`. Public API:
`apps/api/src/modules/employees/index.ts:1-3`. Contract:
`packages/contracts/src/employees/employee.contract.ts:1-63`. Adapter with lazily created
resource: `apps/api/src/infrastructure/queue/bullmq-job-queue.ts:7-31`. Randomness adapter:
`apps/api/src/infrastructure/system/uuid-v7-generator.ts:1-23`.

README decisions applied: 2 (User separate from Employee — the `employeeId` link is **not** added
here, it arrives with invitations in plan 003), 3, 4, 5, 8.

## Out of scope

- Roles, permissions, scopes, 403, protecting the existing organization/employees/attendance
  endpoints (plan 002). After this plan those endpoints are still open.
- Creating users over HTTP, invitations, activation, password reset, password change, email
  sending, linking `User` ↔ `Employee` (plan 003).
- Web and mobile login screens; `credentials: 'include'` in the api-client (plan 004).
- Listing a user's sessions/devices, "close all sessions", revoking sessions on colaborador
  termination (plan 003 or later).
- MFA, OAuth/SSO, CAPTCHA.
- Valkey cache of sessions; purging expired sessions/throttle rows (a later job).
- `trust proxy` / production reverse-proxy configuration of `req.ip`.
- PII encryption, audit log module, multi-tenancy/RLS.
- Any change to `docs/adr/0010-integridad-referencial-entre-modulos.md` (it has uncommitted user
  edits; do not touch it).

## Dependencies

None

## Steps

1. **Contract**
   - Files: `packages/contracts/src/identity/auth.contract.ts` (create), `packages/contracts/src/index.ts` (modify)
   - Do: following `packages/contracts/src/employees/employee.contract.ts`, define:
     - `SessionClientSchema = z.enum(['web', 'mobile'])`.
     - `SessionUserSchema = z.object({ id: z.uuid(), email: z.email() })`, type `SessionUser`.
     - `LogInSchema = z.object({ email: z.email(), password: z.string().min(1).max(128), client: SessionClientSchema })`, type `LogInInput = z.input<…>`. No strength rule here: login must accept whatever the user types (policy is only enforced when a password is set).
     - `LogInResponseSchema = z.object({ user: SessionUserSchema, expiresAt: z.iso.datetime(), token: z.string().nullable().describe('Solo para client=mobile; en web viaja en una cookie httpOnly') })`.
     - `authRoutes = { logIn: defineRoute({ method: 'POST', path: '/auth/login', summary: 'Inicia sesión con correo y contraseña', body: LogInSchema, response: LogInResponseSchema }), logOut: defineRoute({ method: 'POST', path: '/auth/logout', summary: 'Cierra la sesión actual', response: z.undefined(), successStatus: 204 }), me: defineRoute({ method: 'GET', path: '/auth/me', summary: 'Usuario de la sesión actual', response: SessionUserSchema }) }`.
     - In `index.ts`: `export * from './identity/auth.contract';`, import `authRoutes` and add `identity: authRoutes` to `apiRoutes` (`packages/contracts/src/index.ts:10-13`).
   - Observable result: `pnpm --filter @rrhh/contracts typecheck` passes; `api.identity.logIn` is typed in `@rrhh/api-client`.

2. **Shared kernel error categories**
   - Files: `packages/domain/src/errors.ts` (modify)
   - Do: after `ConflictError` (`packages/domain/src/errors.ts:33`) add two abstract categories with a one-line Spanish doc comment each: `export abstract class AuthenticationError extends DomainError {}` (la identidad no se pudo comprobar → 401) and `export abstract class TooManyRequestsError extends DomainError {}` (demasiados intentos → 429). They are already re-exported by `packages/domain/src/index.ts:7`.
   - Observable result: `pnpm --filter @rrhh/domain typecheck` passes.

3. **Env configuration and dependencies**
   - Files: `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify), `apps/api/package.json` (modify), `package.json` (modify), `pnpm-lock.yaml` (modify)
   - Do:
     - Add to `EnvSchema` (`apps/api/src/config/env.ts:9-34`), each `z.coerce.number().int().positive().default(N)`: `SESSION_WEB_IDLE_MINUTES` (30), `SESSION_WEB_ABSOLUTE_HOURS` (12), `SESSION_MOBILE_ABSOLUTE_DAYS` (30), `LOGIN_MAX_FAILURES` (5), `LOGIN_FAILURE_WINDOW_MINUTES` (15), `LOGIN_BLOCK_MINUTES` (15). Add `SEED_USER_PASSWORD: z.string().min(12).optional()`. Comment in Spanish: session values are development values (README decision 5).
     - Append a `# ── Sesiones y login ──` block to `apps/api/.env.example` with those variables and their defaults, and `SEED_USER_PASSWORD=` empty with a comment "contraseña del usuario admin@example.com que crea `pnpm db:seed`; vacío = no se crea". Never touch `.env`.
     - `pnpm --filter @rrhh/api add cookie-parser` and `pnpm --filter @rrhh/api add -D @types/cookie-parser` (the lockfile changes only through pnpm).
     - Root `package.json` engines: `"node": ">=24.7"` (`crypto.argon2` was added in v24.7.0).
   - Observable result: `apps/api/src/config/env.test.ts` still passes; `loadEnv` returns the new defaults when the vars are absent.

4. **Domain: User**
   - Files: `apps/api/src/modules/identity/domain/user.ts` (create), `apps/api/src/modules/identity/domain/user.repository.ts` (create), `apps/api/src/modules/identity/domain/password-policy.ts` (create), `apps/api/src/modules/identity/domain/errors.ts` (create)
   - Do:
     - `user.ts`: `UserId = Id<'User'>`; `USER_STATUSES = ['ACTIVE', 'DISABLED'] as const`, `UserStatus`; `UserProps { email: Email; passwordHash: string; status: UserStatus }`; event constant `USER_REGISTERED = 'identity.user.registered'`. `class User extends AggregateRoot<UserId>` with private constructor, `static register({ id, email, passwordHash, now }): User` (status `ACTIVE`, records `USER_REGISTERED` with `{ userId }`; no `Result` needed because inputs are already-valid value objects — mirror `employee.ts:70-83`), `static restore(id, props)`, getter `canSignIn` (`status === 'ACTIVE'`), getter `snapshot`. No setters, no delete (ADR 0010 rule 1).
     - `password-policy.ts`: `PASSWORD_MIN_LENGTH = 12`, `PASSWORD_MAX_LENGTH = 128`, `checkPasswordPolicy(plain: string): Result<void, WeakPasswordError>` rejecting length outside the range (count Unicode code points: `[...plain].length`). Comment: NIST SP 800-63B favors length over composition rules.
     - `user.repository.ts`: `UserRepository { findById(id: UserId): Promise<User | null>; findByEmail(email: Email): Promise<User | null>; save(user: User): Promise<Result<void, UserAlreadyExistsError>> }`.
     - `errors.ts`: `InvalidCredentialsError extends AuthenticationError` (`code = 'INVALID_CREDENTIALS'`, message `'Correo o contraseña incorrectos'`, no details — never reveal whether the email exists); `LoginTemporarilyBlockedError extends TooManyRequestsError` (`'LOGIN_TEMPORARILY_BLOCKED'`, `'Demasiados intentos fallidos. Intenta de nuevo más tarde'`, details `{ retryAfterSeconds }`); `UserAlreadyExistsError extends ConflictError` (`'USER_ALREADY_EXISTS'`, `'Ya existe un usuario con ese correo'`); `WeakPasswordError extends InvalidValueError` (`override readonly code = 'WEAK_PASSWORD'`, message stating the min/max).
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes; `pnpm arch:check` shows `domain/` imports only `@rrhh/domain`.

5. **Domain: Session and LoginThrottle**
   - Files: `apps/api/src/modules/identity/domain/session.ts` (create), `apps/api/src/modules/identity/domain/session.repository.ts` (create), `apps/api/src/modules/identity/domain/login-throttle.ts` (create), `apps/api/src/modules/identity/domain/login-throttle.repository.ts` (create)
   - Do:
     - `session.ts`: `SessionId = Id<'Session'>`; `SESSION_CLIENTS = ['WEB', 'MOBILE'] as const`, `SessionClient`; `SessionLifetime { absoluteMs: number; idleMs: number | null }`; `SessionPolicy = Record<SessionClient, SessionLifetime>`; events `SESSION_STARTED = 'identity.session.started'`, `SESSION_REVOKED = 'identity.session.revoked'`. `SessionProps { userId: UserId; tokenHash: string; client: SessionClient; createdAt: Date; lastSeenAt: Date; expiresAt: Date; idleTimeoutMs: number | null; revokedAt: Date | null; ip: string | null; userAgent: string | null }`. `class Session extends AggregateRoot<SessionId>`: `static start({ id, userId, tokenHash, client, lifetime, now, ip, userAgent }): Session` (`expiresAt = now + absoluteMs`, `lastSeenAt = createdAt = now`, records `SESSION_STARTED` `{ sessionId, userId, client }`); `static restore`; `isActiveAt(now)` = not revoked AND `now < expiresAt` AND (`idleTimeoutMs === null` OR `now - lastSeenAt < idleTimeoutMs`); `touch(now)` sets `lastSeenAt`; `needsTouch(now)` = `now - lastSeenAt >= TOUCH_INTERVAL_MS` (constant 60_000, comment: avoids one write per request); `revoke(now)` sets `revokedAt` and records `SESSION_REVOKED` `{ sessionId, userId }`, no-op if already revoked; getter `snapshot`.
     - `session.repository.ts`: `SessionRepository { findById(id: SessionId): Promise<Session | null>; findByTokenHash(tokenHash: string): Promise<Session | null>; save(session: Session): Promise<void> }`.
     - `login-throttle.ts`: `LoginThrottlePolicy { maxFailures: number; windowMs: number; blockMs: number }`. `class LoginThrottle extends Entity<string>` (id = key such as `email:ana@example.com` or `ip:10.0.0.1`; static helpers `LoginThrottle.keyForEmail(email: Email)` and `keyForIp(ip: string)`), props `{ failures: number; windowStartedAt: Date; blockedUntil: Date | null }`. `static fresh(key, now)`, `static restore(key, props)`, `blockedUntilAt(now): Date | null` (returns `blockedUntil` only if still in the future), `registerFailure(now, policy)`: if `now - windowStartedAt >= windowMs` restart the window with failures = 0 and `blockedUntil = null`; then `failures += 1`; if `failures >= maxFailures` set `blockedUntil = now + blockMs`. `clear(now)` resets failures, window and block. Getter `snapshot`.
     - `login-throttle.repository.ts`: `LoginThrottleRepository { find(key: string): Promise<LoginThrottle | null>; save(throttle: LoginThrottle): Promise<void> }`.
   - Observable result: typecheck and `pnpm arch:check` pass.

6. **Application ports**
   - Files: `apps/api/src/shared/application/actor.ts` (create), `apps/api/src/modules/identity/application/ports/password-hasher.ts` (create), `apps/api/src/modules/identity/application/ports/session-tokens.ts` (create)
   - Do:
     - `shared/application/actor.ts` (shared because `src/http/` consumes it and plan 002 extends it): `interface Actor { userId: string; sessionId: string }`; `interface RequestAuthenticator { authenticate(token: string): Promise<Actor | null> }` — doc: returns null for unknown, expired, revoked or disabled; never throws for those.
     - `password-hasher.ts`: `interface PasswordHasher { hash(plain: string): Promise<string>; verify(plain: string, hash: string): Promise<boolean>; simulateVerify(plain: string): Promise<void> }` — doc on `simulateVerify`: costs the same as `verify`, used when the email does not exist so response time does not reveal it.
     - `session-tokens.ts`: `interface SessionTokens { issue(): { token: string; tokenHash: string }; hashOf(token: string): string }` — doc: only the hash is persisted.
   - Observable result: typecheck passes; `pnpm arch:check` (`shared-application-is-pure`) passes.

7. **Application: commands, authenticator, query**
   - Files: `apps/api/src/modules/identity/application/commands/register-user.command.ts` (create), `apps/api/src/modules/identity/application/commands/log-in.command.ts` (create), `apps/api/src/modules/identity/application/commands/log-out.command.ts` (create), `apps/api/src/modules/identity/application/session-authenticator.ts` (create), `apps/api/src/modules/identity/application/queries/user.queries.ts` (create), `apps/api/src/modules/identity/application/queries/get-current-user.query.ts` (create)
   - Do (shape of `register-employee.command.ts:26-72`; each `Deps` lists only what it uses):
     - `RegisterUser implements Command<{ email: string; password: string }, { id: UserId }>`; deps `userRepository, passwordHasher, idGenerator, clock, eventBus`. Flow: `Email.create` → `checkPasswordPolicy` → `findByEmail` exists → `err(UserAlreadyExistsError)` → `passwordHasher.hash` → `User.register` → `save` (propagate err) → `eventBus.publish(user.pullEvents())` → `ok({ id })`.
     - `LogIn implements Command<LogInCommandInput, LogInOutput>` where input `{ email: string; password: string; client: 'web' | 'mobile'; ip: string | null; userAgent: string | null }` and output `{ user: { id: string; email: string }; token: string; expiresAt: Date }`. Deps `userRepository, sessionRepository, loginThrottleRepository, passwordHasher, sessionTokens, sessionPolicy, loginThrottlePolicy, idGenerator, clock, eventBus`. Flow, in this order:
       1. `now = clock.now()`. `Email.create(input.email)`; if invalid → `await passwordHasher.simulateVerify(input.password)` and return `err(InvalidCredentialsError)`.
       2. Load throttles for `keyForEmail(email)` and, if `ip` is not null, `keyForIp(ip)` (`find` or `LoginThrottle.fresh`). If any `blockedUntilAt(now)` is not null → `err(LoginTemporarilyBlockedError)` with `retryAfterSeconds = ceil((max blockedUntil - now) / 1000)`. Do not hash anything in this branch.
       3. `user = findByEmail(email)`. Compute `valid`: if no user → `simulateVerify` and `false`; else `verify(input.password, user.snapshot.passwordHash) && user.canSignIn` (a DISABLED user gets the same error as a wrong password).
       4. If not valid: `registerFailure(now, loginThrottlePolicy)` on each loaded throttle, `save` each, return `err(InvalidCredentialsError)`.
       5. If valid: `clear(now)` the email throttle and save it (the IP throttle is left as is). `const { token, tokenHash } = sessionTokens.issue()`. `client = input.client === 'web' ? 'WEB' : 'MOBILE'`. `Session.start({ id: idGenerator.next() as SessionId, userId: user.id, tokenHash, client, lifetime: sessionPolicy[client], now, ip, userAgent })`, `sessionRepository.save`, publish events, return `ok({ user: { id: user.id, email: user.snapshot.email.value }, token, expiresAt: session.snapshot.expiresAt })`.
          No `transactionRunner`: the throttle rows and the session are independent and tolerate a lost update (comment it).
     - `LogOut implements Command<{ sessionId: string }, void>`; deps `sessionRepository, clock, eventBus`. Not found → `ok(undefined)` (idempotent); else `revoke(now)`, `save`, publish, `ok(undefined)`.
     - `SessionAuthenticator implements RequestAuthenticator`; deps `sessionRepository, userRepository, sessionTokens, clock`. `authenticate(token)`: `findByTokenHash(sessionTokens.hashOf(token))`; null or `!isActiveAt(now)` → null; `user = findById(session.snapshot.userId)`; null or `!canSignIn` → null; if `needsTouch(now)` → `touch(now)` and `save`; return `{ userId: user.id, sessionId: session.id }`.
     - `user.queries.ts`: `UserQueries { findSessionUser(userId: string): Promise<SessionUser | null> }` (`SessionUser` from `@rrhh/contracts`). `get-current-user.query.ts`: `GetCurrentUser implements UseCase<{ userId: string }, SessionUser | null>` delegating to `userQueries` (shape of `list-employees.query.ts:7-13`).
   - Observable result: typecheck and `pnpm arch:check` (`application-no-infrastructure`) pass.

8. **Infrastructure adapters**
   - Files: `apps/api/src/modules/identity/infrastructure/user.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/session.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/login-throttle.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-user.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-session.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-login-throttle.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-user.queries.ts` (create), `apps/api/src/modules/identity/infrastructure/argon2-password-hasher.ts` (create), `apps/api/src/modules/identity/infrastructure/crypto-session-tokens.ts` (create)
   - Do:
     - Mappers `toDomain(row)` / `toPersistence(aggregate)` as in `employee.mapper.ts:7-44`; `Session` stores `idleTimeoutMs` as `idle_timeout_seconds` (convert ×/÷ 1000); invalid stored email → throw (same as `employee.mapper.ts:14-15`).
     - `PrismaUserRepository`: `findById`, `findByEmail` (`where: { email: email.value }`), `save` via `upsert`, mapping `isUniqueViolation` to `UserAlreadyExistsError` (`prisma-employee.repository.ts:31-46`). `PrismaSessionRepository` and `PrismaLoginThrottleRepository`: `upsert` by id/key, finds by unique columns.
     - `PrismaUserQueries.findSessionUser`: `findUnique({ where: { id }, select: { id: true, email: true } })`.
     - `Argon2PasswordHasher`: uses `argon2` from `node:crypto` (promisify the callback form) with `argon2id`, `memory: 19456` (KiB), `passes: 2`, `parallelism: 1`, `tagLength: 32`, `nonce: randomBytes(16)` — OWASP Password Storage Cheat Sheet minimum; keep them as named constants with that source in a comment. Encodes PHC string `$argon2id$v=19$m=19456,t=2,p=1$<salt b64 no padding>$<hash b64 no padding>`; `verify` parses the PHC string (using its own parameters, so a future parameter change still verifies old hashes), recomputes and compares with `timingSafeEqual`; returns false on a malformed hash. `simulateVerify` verifies against a hash computed once lazily (`#dummyHash ??=`, like `bullmq-job-queue.ts:13-16`) of a fixed string.
     - `CryptoSessionTokens`: `issue()` → `randomBytes(32).toString('base64url')`; `hashOf` → SHA-256 hex (64 chars). Comment: a 256-bit random token needs no slow hash.
   - Observable result: typecheck and `pnpm arch:check` (`prisma-only-in-infrastructure`) pass.

9. **In-memory adapters for tests**
   - Files: `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-session.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-login-throttle.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.queries.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/fake-password-hasher.ts` (create)
   - Do: Map-backed repositories like `in-memory-employee.repository.ts:7-35` (user `save` rejects a duplicate email of another id with `UserAlreadyExistsError`). `InMemoryUserQueries` reads from an `InMemoryUserRepository` passed in the constructor. `FakePasswordHasher`: `hash(p)` → `` `fake:${p}` ``, `verify(p, h)` → `h === \`fake:${p}\``, `simulateVerify`resolves; records how many times`simulateVerify` was called (public counter) so tests can assert the timing branch ran.
   - Observable result: typecheck passes; `no-test-code-in-production` rule passes (nothing outside tests imports `in-memory/`).

10. **Persistence and migration**
    - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/<timestamp>_create_identity/migration.sql` (create)
    - Do (skill `db-change`): add `"identity"` to `datasource.schemas` (`apps/api/prisma/schema.prisma:19`) and a `// ── Módulo: identity ──` section:
      - `enum UserStatus { ACTIVE DISABLED @@schema("identity") }`, `enum SessionClient { WEB MOBILE @@schema("identity") }`.
      - `model User { id String @id @db.Uuid; email String @unique @db.VarChar(254); passwordHash String @map("password_hash") @db.Text; status UserStatus @default(ACTIVE); createdAt/updatedAt as in Company (lines 30-31); sessions Session[]; @@map("users") @@schema("identity") }`.
      - `model Session { id String @id @db.Uuid; userId String @map("user_id") @db.Uuid; user User @relation(fields: [userId], references: [id]); tokenHash String @unique @map("token_hash") @db.Char(64); client SessionClient; createdAt DateTime @map("created_at") @db.Timestamptz(3); lastSeenAt DateTime @map("last_seen_at") @db.Timestamptz(3); expiresAt DateTime @map("expires_at") @db.Timestamptz(3); idleTimeoutSeconds Int? @map("idle_timeout_seconds"); revokedAt DateTime? @map("revoked_at") @db.Timestamptz(3); ip String? @db.VarChar(45); userAgent String? @map("user_agent") @db.VarChar(500); @@index([userId]) @@map("sessions") @@schema("identity") }` — the FK is inside the module's own schema, which ADR 0010 allows.
      - `model LoginThrottle { key String @id @db.VarChar(320); failures Int; windowStartedAt DateTime @map("window_started_at") @db.Timestamptz(3); blockedUntil DateTime? @map("blocked_until") @db.Timestamptz(3); @@map("login_throttles") @@schema("identity") }`.
      - The mappers must truncate `userAgent` to 500 chars before persisting.
      - Run `pnpm db:migrate --name create_identity` (requires `pnpm db:up`), then `pnpm db:generate`. Never edit `20260926030736_init`.
    - Observable result: a new migration directory creating schema `identity` with three tables; `pnpm db:generate` produces `User`, `Session`, `LoginThrottle` models.

11. **HTTP plumbing: request context, authentication middleware, error mapping**
    - Files: `apps/api/src/http/request-context.ts` (create), `apps/api/src/http/authenticate.ts` (create), `apps/api/src/http/bind-route.ts` (modify), `apps/api/src/http/error-handler.ts` (modify), `apps/api/src/http/app.ts` (modify)
    - Do:
      - `request-context.ts`: `SESSION_COOKIE = '__Host-rrhh_session'`; `interface RequestContext { actor: Actor | null; client: { ip: string | null; userAgent: string | null }; cookies: { set(name: string, value: string, expires: Date): void; clear(name: string): void } }`; `class AuthenticationRequiredError extends Error` (adapter error like `request-validation-error.ts:3-14`, `code = 'AUTHENTICATION_REQUIRED'`, message `'Debes iniciar sesión'`); `requireActor(context): Actor` throws it when `actor` is null.
      - `authenticate.ts`: `createAuthenticate(deps: { requestAuthenticator: RequestAuthenticator; allowedOrigins: readonly string[] }): RequestHandler`. Token = `Authorization: Bearer <t>` if present, else `req.cookies[SESSION_COOKIE]` (transport `cookie`). No token → `res.locals.actor = null`. Cookie transport with a method other than GET/HEAD/OPTIONS and an `Origin` header that is absent or not in `allowedOrigins` → `actor = null` (CSRF defense on top of SameSite=Lax; comment why). Otherwise `res.locals.actor = await requestAuthenticator.authenticate(token)`. Unknown/expired tokens never produce an error here; routes decide with `requireActor`.
      - `bind-route.ts`: `RouteHandler<R>` becomes `(request: ParsedRequest<R>, context: RequestContext) => Promise<RouteResponse<R>>` (existing handlers that take one argument still compile). Build the context per request: `actor: res.locals.actor ?? null`, `client: { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null }`, `cookies.set` → `res.cookie(name, value, { httpOnly: true, secure: true, sameSite: 'lax', path: '/', expires })`, `cookies.clear` → `res.clearCookie(name, { httpOnly: true, secure: true, sameSite: 'lax', path: '/' })`. Type `res.locals.actor` without `any` (e.g. read it as `unknown` and narrow, or declare the `Locals` interface augmentation for Express 5 in this file).
      - `error-handler.ts`: add `[AuthenticationError, 401]` and `[TooManyRequestsError, 429]` to `STATUS_BY_CATEGORY` (`error-handler.ts:19-27`); handle `AuthenticationRequiredError` like `RequestValidationError` but with 401 and body `{ code, message }`. For `LoginTemporarilyBlockedError` also set the `Retry-After` header from `details.retryAfterSeconds` (check `error instanceof TooManyRequestsError` and a numeric `details.retryAfterSeconds`).
      - `app.ts`: `import cookieParser from 'cookie-parser'`; `app.use(cookieParser())` right after `express.json` (`app.ts:39`); then `app.use(API_PREFIX, createAuthenticate({ requestAuthenticator: container.cradle.requestAuthenticator, allowedOrigins: env.CORS_ORIGINS }))` before the `api` router (`app.ts:43-47`). Device routes (`app.ts:35-37`) stay unauthenticated (ADR 0008).
    - Observable result: typecheck passes; `pnpm --filter @rrhh/api test` still green (existing HTTP tests unaffected: no endpoint requires a session yet).

12. **Router, module registration, container, seed**
    - Files: `apps/api/src/modules/identity/http/identity.router.ts` (create), `apps/api/src/modules/identity/identity.module.ts` (create), `apps/api/src/modules/identity/index.ts` (create), `apps/api/src/container.ts` (modify), `apps/api/prisma/seed.ts` (modify)
    - Do:
      - Router (`employees.router.ts:9-24` shape), `createIdentityRouter(deps: { logIn; logOut; getCurrentUser })` with `authRoutes as routes`:
        - `logIn`: `const out = unwrap(await deps.logIn.execute({ ...body, ip: ctx.client.ip, userAgent: ctx.client.userAgent }))`; if `body.client === 'web'` → `ctx.cookies.set(SESSION_COOKIE, out.token, out.expiresAt)` and respond `token: null`; else respond the token. Always `expiresAt: out.expiresAt.toISOString()`.
        - `logOut`: `const actor = requireActor(ctx)`; `unwrap(await deps.logOut.execute({ sessionId: actor.sessionId }))`; `ctx.cookies.clear(SESSION_COOKIE)`; return `undefined`.
        - `me`: `requireActor(ctx)`; `const user = await deps.getCurrentUser.execute({ userId: actor.userId })`; null → `throw new AuthenticationRequiredError()`; return user.
      - `identity.module.ts`: `IdentityCradle` with `userRepository, sessionRepository, loginThrottleRepository, userQueries, passwordHasher, sessionTokens, sessionPolicy, loginThrottlePolicy, registerUser, logIn, logOut, getCurrentUser, requestAuthenticator` (types: the ports/classes above; `requestAuthenticator: RequestAuthenticator`). Registrations `asClass(...).singleton()`; `requestAuthenticator: asClass(SessionAuthenticator).singleton()`; `sessionPolicy` and `loginThrottlePolicy` via `asFunction(({ env }: { env: Env }) => ({ WEB: { absoluteMs: env.SESSION_WEB_ABSOLUTE_HOURS * 3_600_000, idleMs: env.SESSION_WEB_IDLE_MINUTES * 60_000 }, MOBILE: { absoluteMs: env.SESSION_MOBILE_ABSOLUTE_DAYS * 86_400_000, idleMs: null } })).singleton()` and the analogous throttle policy from `LOGIN_MAX_FAILURES`, `LOGIN_FAILURE_WINDOW_MINUTES`, `LOGIN_BLOCK_MINUTES`. `router: createIdentityRouter`.
      - `index.ts`: export `identityModule`, `type IdentityCradle`, and the event constants `USER_REGISTERED`, `SESSION_STARTED`, `SESSION_REVOKED` (nothing else: plan 002/003 will add a facade when another module needs one).
      - `container.ts`: import from `./modules/identity`; `modules = [identityModule, organizationModule, employeesModule, attendanceModule]` (`container.ts:37`); add `& IdentityCradle` to `Cradle` (`container.ts:53`).
      - `seed.ts`: after the employees block, if `env.SEED_USER_PASSWORD` is set run `registerUser.execute({ email: 'admin@example.com', password: env.SEED_USER_PASSWORD })`, log `'usuario creado'`, ignore `USER_ALREADY_EXISTS`, throw other errors; if unset, `logger.info` that the user was skipped and why. Never hard-code a password.
    - Observable result: `tests/container.test.ts` resolves every registration; `pnpm arch:check` passes; `pnpm db:seed` with `SEED_USER_PASSWORD` set in the developer's own `.env` creates the user once and is idempotent.

13. **Test app wiring**
    - Files: `apps/api/tests/test-app.ts` (modify)
    - Do: in `buildTestContainer` (`tests/test-app.ts:22-55`) register `userRepository`, `sessionRepository`, `loginThrottleRepository`, `userQueries` (in-memory, `InMemoryUserQueries` over the same user repository) and `passwordHasher: asValue(new FakePasswordHasher())`. Keep the real `CryptoSessionTokens`, `SessionAuthenticator` and policies.
    - Observable result: `pnpm --filter @rrhh/api test` green.

14. **Documentation**
    - Files: `docs/adr/0011-sesiones-opacas-en-postgres.md` (create), `docs/adr/README.md` (modify), `docs/architecture.md` (modify), `docs/harness/modules.json` (modify)
    - Do: ADR 0011 from `docs/adr/0000-plantilla.md` in Spanish: context (no auth; architecture.md anticipated JWT), decision (opaque 256-bit tokens, SHA-256 hash in `identity.sessions`, cookie `__Host-rrhh_session` httpOnly/Secure/SameSite=Lax + Origin check for web, Bearer for mobile, argon2id via `node:crypto`, throttle in Postgres), consequences (one indexed query per authenticated request; instant revocation; no refresh-token flow; Node ≥ 24.7), alternatives (JWT, Valkey) — cite `plans/identity-acceso/README.md` decisions 4-5. Add row 0011 to the ADR index table (`docs/adr/README.md`). In `docs/architecture.md:131` replace "access + refresh token, apto para mobile" with "sesiones opacas revocables (ADR 0011), cookie en web y Bearer en mobile". In `docs/harness/modules.json` set identity `status: "active"` and summary `"Usuarios, login y sesiones opacas (ADR 0011); RBAC y contexto de request."`.
    - Observable result: `pnpm check` passes (includes harness/plans checks).

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass.
- [ ] Migration `*_create_identity` applied: schema `identity` has `users`, `sessions`, `login_throttles`; `users.password_hash` starts with `$argon2id$v=19$m=19456,t=2,p=1$` for the seeded user; no plaintext password or token is stored anywhere.
- [ ] `POST /api/v1/auth/login` with `{ email, password, client: "web" }` and valid credentials → 200, body `{ user: { id, email }, expiresAt, token: null }`, and a `Set-Cookie: __Host-rrhh_session=…; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax`.
- [ ] Same with `client: "mobile"` → 200 with a non-null `token`, no `Set-Cookie`; `sessions.token_hash` equals SHA-256 of that token, not the token.
- [ ] `GET /api/v1/auth/me` with `Authorization: Bearer <token>` → 200 `{ id, email }`; with the web cookie → 200; without credentials, or with an unknown token → 401 `{ code: "AUTHENTICATION_REQUIRED" }`.
- [ ] Wrong password, unknown email, malformed email and a DISABLED user all → 401 `{ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos" }` with identical bodies.
- [ ] After 5 failed attempts for one email within 15 min, the next attempt (even with the right password) → 429 `{ code: "LOGIN_TEMPORARILY_BLOCKED" }` with a `Retry-After` header; a successful login before the limit resets that email's counter.
- [ ] `POST /api/v1/auth/logout` with a valid session → 204, cookie cleared; the same token then gets 401 on `/auth/me`; `sessions.revoked_at` is set. Without a session → 401.
- [ ] A cookie-authenticated `POST /auth/logout` whose `Origin` is not in `CORS_ORIGINS` (or is missing) → 401 (treated as unauthenticated); the session stays active.
- [ ] A web session idle longer than `SESSION_WEB_IDLE_MINUTES`, or older than `SESSION_WEB_ABSOLUTE_HOURS`, is rejected (401 on `/auth/me`).
- [ ] Existing endpoints (`/companies`, `/companies/:id/employees`, `/iclock/*`) behave exactly as before without any credentials.
- [ ] `pnpm db:seed` twice with `SEED_USER_PASSWORD` set creates `admin@example.com` once; without it, no user is created and a log line says why.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                             |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `User.register`/`canSignIn`, `checkPasswordPolicy` bounds, `Session` activity (absolute, idle, revoked, touch interval), `LoginThrottle` window/block/clear                                                                                       |
| application | yes     | `RegisterUser` happy path + each error; `LogIn` every branch (invalid email, blocked, unknown user → `simulateVerify`, wrong password, disabled, success clears email throttle); `LogOut` idempotent; `SessionAuthenticator` null cases and touch |
| contract    | yes     | `LogInSchema`, `LogInResponseSchema` (`token` nullable), `authRoutes` shape                                                                                                                                                                       |
| http        | yes     | login web (Set-Cookie attributes) / mobile (token), me via Bearer and cookie, 401 bodies, 429 + Retry-After, logout + reuse, Origin check, existing routes still open                                                                             |
| integration | yes     | Prisma user/session/throttle repositories against `rrhh_test` (unique email → `USER_ALREADY_EXISTS`, find by token hash, upserts); `Argon2PasswordHasher` round-trip and malformed hash                                                           |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                                       |

## Deviations

- **Orden de ejecución del paso 10 antes que 8-9**: los mappers/repositorios Prisma del paso 8
  importan tipos del cliente generado (`@/infrastructure/database/generated/client`), que solo
  existen tras `pnpm db:generate`, y este a su vez requiere el schema y la migración del paso 10.
  Se ejecutó primero `schema.prisma` + `pnpm db:migrate --name create_identity` + `pnpm db:generate`
  (paso 10), y luego los pasos 8 y 9 con los tipos ya disponibles. Mismos archivos y contenido que
  pide el plan; solo cambió la secuencia por una dependencia técnica dura, no de alcance ni diseño.
- **`InMemoryUserQueries` (paso 9) no importa `InMemoryUserRepository`**: el plan dice "lee desde un
  `InMemoryUserRepository` inyectado en el constructor", pero tipar el constructor con esa clase
  concreta dispara la regla `no-test-code-in-production` de `arch:check` (cualquier archivo fuera de
  `.test.ts`/`tests/` que importe algo bajo `/in-memory/` queda marcado, incluso otro archivo
  `/in-memory/` hermano). En su lugar, `InMemoryUserQueries` depende de una interfaz estructural
  mínima local `UserStore { readonly users: ReadonlyMap<string, User> }`, que `InMemoryUserRepository`
  cumple sin necesidad de importarla. `apps/api/tests/test-app.ts` sigue pasando una instancia real
  de `InMemoryUserRepository` en el constructor; el comportamiento en runtime es idéntico.
- **Smoke test manual fuera del pipeline de tests**: además de `pnpm check` y `pnpm test:integration`
  (verdes), se ejecutó un script ad hoc (no versionado, en el scratchpad) contra la base de
  desarrollo real que recorrió `registerUser → logIn` (contraseña incorrecta y luego correcta) →
  `requestAuthenticator.authenticate` → `getCurrentUser` → `logOut` → reintento de `authenticate`
  tras logout, confirmando que el hash guardado tiene el formato PHC exacto del criterio de
  aceptación (`$argon2id$v=19$m=19456,t=2,p=1$…`) y que la sesión queda inválida tras revocarla. Los
  datos de prueba se borraron después (con `SELECT`/`count` previos que probaron el `WHERE` antes del
  `deleteMany`, siguiendo la convención de HARNESS.md).
- **No se ejecutó `pnpm db:seed` con `SEED_USER_PASSWORD` definida**: el hook `guard-bash` bloquea
  toda forma de inyectar una variable de entorno efímera en un comando (`VAR=valor cmd`, `env`,
  script wrapper) dentro de este sandbox. Se verificó la rama "sin contraseña" (loguea el motivo del
  salto, como pide el criterio de aceptación) y, por revisión de código más `tests/container.test.ts`
  (que resuelve `registerUser` y el resto del cradle de `identity` sin lanzar), la rama "con
  contraseña" está correctamente cableada, pero no se ejecutó end-to-end aquí. Queda para el Verifier,
  que corre en un entorno donde sí puede fijar `SEED_USER_PASSWORD` para el chequeo del plan
  (`pnpm db:seed` dos veces → un solo usuario `admin@example.com`).

## Test coverage

## Review findings

## Verification
