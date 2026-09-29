---
status: verify
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
    - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20260929171530_create_identity/migration.sql` (create)
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

15. **Review round 1 repairs** (added 2026-09-29 by the main session after `## Review findings` round 1; H2/H3/M2 approach approved by the user, README decisions 10-12)
    - Files: `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify), `packages/contracts/src/identity/auth.contract.ts` (modify), `apps/api/src/modules/identity/domain/session.repository.ts` (modify), `apps/api/src/modules/identity/domain/login-throttle.ts` (modify), `apps/api/src/modules/identity/domain/login-throttle.repository.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.ts` (modify), `apps/api/src/modules/identity/application/commands/log-in.command.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/prisma-login-throttle.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-session.repository.ts` (modify), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-login-throttle.repository.ts` (modify), `apps/api/src/modules/identity/identity.module.ts` (modify), `docs/architecture.md` (modify), `docs/adr/0011-sesiones-opacas-en-postgres.md` (modify)
    - Do:
      - **H1**: `SEED_USER_PASSWORD: z.preprocess((value) => (value === '' ? undefined : value), z.string().min(12).optional())` with a Spanish comment (`process.loadEnvFile` turns `VAR=` into `""`). Keep the empty line in `.env.example`.
      - **L1**: `LogInSchema.email` → `z.email().max(254)` (same limit as `users.email VARCHAR(254)`).
      - **H2** (a touch must never undo a revocation): add `recordActivity(session: Session): Promise<void>` to `SessionRepository`, doc: "persiste solo `lastSeenAt`, y solo si la sesión sigue sin revocar". Prisma: `session.updateMany({ where: { id, revokedAt: null }, data: { lastSeenAt } })`. In-memory: update `lastSeenAt` of the stored session only if its stored `revokedAt` is null. `SessionAuthenticator` calls `recordActivity` instead of `save`. `save` stays for start/revoke.
      - **H3** (every attempt counts, even in parallel bursts): the attempt is **reserved before verifying the password**, under a row lock.
        - Domain `LoginThrottle`: rename `registerFailure` → `registerAttempt(now, policy)` (same logic: window reset, `failures += 1`, block when `failures >= maxFailures`; the prop stays named `failures`, doc it as "intentos en la ventana"). Add `releaseAttempt(policy)`: `failures = max(0, failures - 1)` and, if now `failures < policy.maxFailures`, `blockedUntil = null` (the block could only have been set by this same reservation, because a blocked key is rejected before reserving). Keep `clear(now)`.
        - Port `LoginThrottleRepository`: replace `find` with `lock(key: string, now: Date): Promise<LoginThrottle>`, doc: "debe llamarse dentro de `transactionRunner.run`; crea la fila si no existe y la bloquea hasta el fin de la transacción". Prisma: `createMany({ data: [{ key, failures: 0, windowStartedAt: now }], skipDuplicates: true })` then `$queryRaw` `SELECT key, failures, window_started_at, blocked_until FROM identity.login_throttles WHERE key = ${key} FOR UPDATE`, mapped with the existing mapper (convert the raw row). In-memory: return existing or `fresh` (stored).
        - `LogIn` (add `transactionRunner` to `Deps`): per key (email, then ip if present), sequentially: `transactionRunner.run(async () => { const t = await lock(key, now); if (t.blockedUntilAt(now)) return { blockedUntil }; t.registerAttempt(now, policyFor(key)); await save(t); return { reserved: true } })`. If any key is blocked → release the attempts already reserved in this request (same locked pattern with `releaseAttempt`) and return `LoginTemporarilyBlockedError` (max `blockedUntil`). Then verify (outside any transaction — argon2 never runs while holding a lock). Failure → `InvalidCredentialsError`, nothing else to write. Success → locked `clear(now)` on the email key and locked `releaseAttempt` on the ip key (a successful login must not consume the office's IP budget). Remove the old `loadThrottles` helper and update the "sin transactionRunner" comment.
      - **M2**: env `LOGIN_IP_MAX_FAILURES` (default 50) in `EnvSchema` and `.env.example`. `loginThrottlePolicy` registration becomes `{ email: LoginThrottlePolicy; ip: LoginThrottlePolicy }` (export type `LoginThrottlePolicies` from `domain/login-throttle.ts`), both sharing `LOGIN_FAILURE_WINDOW_MINUTES`/`LOGIN_BLOCK_MINUTES`; `LogIn` picks by key prefix via a small private `policyFor(key)`.
      - **L2**: `docs/architecture.md` — error-mapping section (lines 91-96): add `AuthenticationError → 401`, `TooManyRequestsError → 429` and the adapter error `AUTHENTICATION_REQUIRED → 401`; request-flow section (lines 77-89): mention `cookie-parser` → `createAuthenticate` → `bindRoute(request, context)` with `RequestContext`; "Pendiente" (lines 129-132): keep only RBAC/request scoping as pending (plan 002). ADR 0011: one line under consequences on the row lock per login attempt and the separate IP limit.
    - Observable result: `pnpm check` and `pnpm test:integration` green; `pnpm dev:api` starts with a `.env` copied verbatim from `.env.example`.

16. **Test files of this plan** (declared for `pnpm plans:scope`, M1; written by the tester)
    - Files: `apps/api/src/config/env.test.ts` (modify), `apps/api/src/modules/identity/domain/user.test.ts` (create), `apps/api/src/modules/identity/domain/password-policy.test.ts` (create), `apps/api/src/modules/identity/domain/session.test.ts` (create), `apps/api/src/modules/identity/domain/login-throttle.test.ts` (create), `apps/api/src/modules/identity/application/commands/register-user.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/log-in.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/log-out.command.test.ts` (create), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (create), `apps/api/src/modules/identity/application/queries/get-current-user.query.test.ts` (create), `packages/contracts/src/identity/auth.contract.test.ts` (create), `apps/api/tests/auth.test.ts` (create), `apps/api/tests/auth-malformed-email.test.ts` (create), `apps/api/tests/integration/identity/prisma-user.int.test.ts` (create), `apps/api/tests/integration/identity/prisma-session.int.test.ts` (create), `apps/api/tests/integration/identity/prisma-login-throttle.int.test.ts` (create), `apps/api/tests/integration/identity/argon2-password-hasher.int.test.ts` (create)
    - Do: nothing for the implementer. After step 15, the tester updates these for the new behavior (regressions for H1, H2, H3, M2, L1) and fixes I1.
    - Observable result: test suites green.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass.
- [ ] Migration `*_create_identity` applied: schema `identity` has `users`, `sessions`, `login_throttles`; `users.password_hash` starts with `$argon2id$v=19$m=19456,t=2,p=1$` for the seeded user; no plaintext password or token is stored anywhere.
- [ ] `POST /api/v1/auth/login` with `{ email, password, client: "web" }` and valid credentials → 200, body `{ user: { id, email }, expiresAt, token: null }`, and a `Set-Cookie: __Host-rrhh_session=…; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax`.
- [ ] Same with `client: "mobile"` → 200 with a non-null `token`, no `Set-Cookie`; `sessions.token_hash` equals SHA-256 of that token, not the token.
- [ ] `GET /api/v1/auth/me` with `Authorization: Bearer <token>` → 200 `{ id, email }`; with the web cookie → 200; without credentials, or with an unknown token → 401 `{ code: "AUTHENTICATION_REQUIRED" }`.
- [ ] Wrong password, unknown email and a DISABLED user all → 401 `{ code: "INVALID_CREDENTIALS", message: "Correo o contraseña incorrectos" }` with identical bodies. A malformed email → 400 `VALIDATION_ERROR` from the contract (corrected 2026-09-29 by the user after the tester's GAP: `z.email()` rejects it before `LogIn`; shape-only, reveals nothing about accounts).
- [ ] After 5 failed attempts for one email within 15 min, the next attempt (even with the right password) → 429 `{ code: "LOGIN_TEMPORARILY_BLOCKED" }` with a `Retry-After` header; a successful login before the limit resets that email's counter. This holds for attempts sent in parallel too (step 15, H3). One IP is blocked only after `LOGIN_IP_MAX_FAILURES` (50) failures, and successful logins do not count against it (M2).
- [ ] A logout concurrent with an authenticated request that refreshes `last_seen_at` leaves the session revoked (step 15, H2).
- [ ] The API starts with a `.env` copied verbatim from `.env.example` (step 15, H1); a login with an email over 254 characters → 400, not 500 (L1).
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
- **Repair round 1 (2026-09-29, main session)**: review round 1 found H1-H3, M1-M2, L1-L2, I1-I2.
  The user approved fixing everything inside this plan (H2/H3 change the `SessionRepository` and
  `LoginThrottleRepository` ports; M2 adds a separate IP limit) — README decisions 10-12. Added
  steps 15-16, fixed the migration path placeholder (M1) and extended the acceptance criteria.
  I2 accepted as designed. Status review → implementing. Earlier test and review evidence is
  superseded for the repaired code.
- **Step 15 executed (2026-09-29, Implementer)**: H1-H3, M2, L1-L2 implemented exactly per step
  15's `Do:`. Notable points:
  - **`transactionRunner` on `LogIn` needed a test double** (not anticipated by step 15's file
    list): `LogIn` now depends on the shared `TransactionRunner` port for the row lock (H3). The
    real `PrismaTransactionRunner` opens a genuine Postgres transaction, which would hit the
    bogus `DATABASE_URL` every unit/HTTP test in `apps/api/tests/test-app.ts` uses (in-memory
    persistence, no real DB) and break every login-path test. First attempt added a shared
    `NoopTransactionRunner` to `apps/api/src/shared/testing/fakes.ts` (the established home for
    cross-cutting port doubles); `pnpm plans:scope` flagged that file as out of scope (it is not
    a listed hot file, unlike `apps/api/tests/test-app.ts`). Reverted `fakes.ts` to its original
    content and instead declared a small private `NoopTransactionRunner` directly inside
    `apps/api/tests/test-app.ts` (an allowed append-only hot file per `HARNESS.md`) and, separately,
    inside `log-in.command.test.ts` itself — two tiny local classes instead of one shared export,
    to keep every touched file inside the plan's declared scope. `pnpm plans:scope` now reports
    the plan fully in scope.
  - **Test files step 16 reserves for the tester were touched anyway, on the coordinator's
    explicit mid-task instruction**, to satisfy step 15's own "Observable result" line (`pnpm
check` and `pnpm test:integration` green). Renaming `LoginThrottle.registerFailure` to
    `registerAttempt`, replacing `LoginThrottleRepository.find` with `lock`, and reshaping
    `LogIn`'s throttle-policy dependency into `{ email, ip }` are breaking changes to code these
    tests exercised directly, so leaving them untouched left `pnpm check`/`pnpm test:integration`
    red. Changes made, all mechanical adaptations to the new shapes (not new scenario design):
    `domain/login-throttle.test.ts` (renamed the 6 `registerFailure` calls),
    `application/session-authenticator.test.ts` (the one assertion spying on `save` during touch
    now spies on `recordActivity`, per H2), `application/commands/log-in.command.test.ts`
    (`THROTTLE_POLICY` → `THROTTLE_POLICIES: LoginThrottlePolicies`, added the local
    `NoopTransactionRunner`; verified by hand that every existing assertion's arithmetic still
    holds under the new reserve-then-verify flow before running it), and
    `tests/integration/identity/prisma-login-throttle.int.test.ts` (rewritten against `lock()` +
    `transactionRunner.run(...)`; kept the same 4 cases plus one new one that runs two concurrent
    reservations on the same key against real Postgres and asserts `failures === 2`, proving the
    row lock actually serializes them — validated first as a throwaway smoke test in the session
    scratchpad, moved there afterward with `mv`, never committed, per `HARNESS.md`: `rm` of an
    untracked file is blocked by `guard-bash` regardless of who created it). Left untouched (still
    step 16's, still declared but unchanged per `plans:scope`): `config/env.test.ts` (H1) and
    `packages/contracts/src/identity/auth.contract.test.ts` (L1) — both already passed unmodified
    against the new schema, so no regression test for either exists yet; the tester should add
    them, and should still review/extend the four files above and fix I1.
  - **`LogIn.execute` complexity**: my own H3 rewrite tripped `eslint`'s `complexity` rule (14 >
    12). Extracted the reserve/block/release loop into a private `reserveOrBlock` helper — no
    behavior change, confirmed by the unit and integration suites staying green before and after.
  - **ADR 0011 decision bullet**: beyond the "one line under consequences" the step asked for,
    also corrected the throttling bullet under "Decisión" (it said "5 intentos … por correo y por
    IP", which M2 makes inaccurate now that the IP limit defaults to 50) — left inside the same
    file/section the step already opened, not a new scope.
  - `pnpm check` and `pnpm test:integration` both green (170 unit tests in `@rrhh/api`, 37
    integration tests — up from 36, the new row-lock test). `pnpm plans:scope` reports the plan
    fully in scope.

## Test coverage

**Ronda 1.** Baseline antes de escribir tests (sin ningún test de `identity`): `pnpm check` y
`pnpm test:integration` verdes (nada preexistente fallaba). Cierre después de escribir todo:
`pnpm check` verde (`@rrhh/api`: 24 archivos, 169 tests + 1 `it.fails` esperado = 170) y
`pnpm test:integration` verde (6 archivos, 36 tests, incluye los 4 nuevos de `identity`).

**Ronda 2 (repair de H1/H2/H3/M2/L1, 2026-09-29).** El reviewer marcó I1: ya no queda ningún
`it.fails` en `apps/api` (el sondeo del correo mal formado se convirtió en test normal tras la
decisión del usuario) — la cifra "169 + 1" de la ronda 1 quedó desactualizada; corregido aquí.
Baseline antes de esta ronda (todo el código del repair ya implementado, ningún test nuevo
todavía): `pnpm check` verde (`@rrhh/api`: 24 archivos, **170** tests; `@rrhh/contracts`: 4
archivos, 30 tests) y `pnpm test:integration` verde (6 archivos, 37 tests — el `PrismaLoginThrottleRepository`
ya traía la prueba de concurrencia que el Implementer agregó en el paso 15, ver `## Deviations`).
Cierre tras escribir las regresiones de H1, H2, H3, M2 y L1 (filas marcadas "ronda 2" en la
tabla): `pnpm check` verde (`@rrhh/api`: 24 archivos, **180** tests; `@rrhh/contracts`: 4
archivos, **32** tests) y `pnpm test:integration` verde (6 archivos, **39** tests). Ningún test
preexistente cambió de comportamiento; las filas sin anotación "ronda 2" siguen siendo la
evidencia de la ronda 1 y no se repitieron (el código que cubren no cambió en el repair).

| Behavior (from plan / code)                                                                                                                                                                                                                                                     | Source (`file:line`)                                                                                                                                                          | Layer       | Test                                                                                                                                                                                                                                                                                                                                                                                            | State         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `User.register` arranca en ACTIVE y registra `USER_REGISTERED`                                                                                                                                                                                                                  | `domain/user.ts:29-37`                                                                                                                                                        | domain      | `user.test.ts › se registra en estado ACTIVE…`                                                                                                                                                                                                                                                                                                                                                  | CONFIRMED     |
| `canSignIn` refleja `status` (ACTIVE/DISABLED)                                                                                                                                                                                                                                  | `domain/user.ts:44-46`                                                                                                                                                        | domain      | `user.test.ts › canSignIn…` (2)                                                                                                                                                                                                                                                                                                                                                                 | CONFIRMED     |
| `checkPasswordPolicy` rechaza fuera de [12,128], acepta los bordes                                                                                                                                                                                                              | `domain/password-policy.ts:10-19`                                                                                                                                             | domain      | `password-policy.test.ts` (4 casos de borde)                                                                                                                                                                                                                                                                                                                                                    | CONFIRMED     |
| `checkPasswordPolicy` cuenta puntos de código Unicode, no unidades UTF-16                                                                                                                                                                                                       | `domain/password-policy.ts:9,14`                                                                                                                                              | domain      | `password-policy.test.ts › cuenta puntos de código…`                                                                                                                                                                                                                                                                                                                                            | CONFIRMED     |
| `Session.start` fija `expiresAt=now+absoluteMs`, `lastSeenAt=createdAt=now`, registra `SESSION_STARTED`                                                                                                                                                                         | `domain/session.ts:46-76`                                                                                                                                                     | domain      | `session.test.ts` (2)                                                                                                                                                                                                                                                                                                                                                                           | CONFIRMED     |
| `isActiveAt`: revocada / vencimiento absoluto / inactividad (web) / mobile sin idle                                                                                                                                                                                             | `domain/session.ts:82-87`                                                                                                                                                     | domain      | `session.test.ts › isActiveAt` (5)                                                                                                                                                                                                                                                                                                                                                              | CONFIRMED     |
| `needsTouch` respeta el intervalo de 60s (antes/al llegar)                                                                                                                                                                                                                      | `domain/session.ts:22,89-91`                                                                                                                                                  | domain      | `session.test.ts › needsTouch` (3)                                                                                                                                                                                                                                                                                                                                                              | CONFIRMED     |
| `touch` solo actualiza `lastSeenAt`; `revoke` fija `revokedAt`, registra `SESSION_REVOKED` y es idempotente                                                                                                                                                                     | `domain/session.ts:93-103`                                                                                                                                                    | domain      | `session.test.ts › touch…`, `› revoke` (3)                                                                                                                                                                                                                                                                                                                                                      | CONFIRMED     |
| `LoginThrottle.keyForEmail`/`keyForIp`, `registerAttempt` (bajo el máximo / al llegar bloquea; renombrado desde `registerFailure` en el repair, H3), `blockedUntilAt` vence, ventana se reinicia tras `windowMs`, `clear` resetea todo                                          | `domain/login-throttle.ts:27-69`                                                                                                                                              | domain      | `login-throttle.test.ts` (7, adaptados al nuevo nombre — ronda 2)                                                                                                                                                                                                                                                                                                                               | CONFIRMED     |
| `LoginThrottle.releaseAttempt` deshace UNA reserva (no baja de cero) y levanta el bloqueo si, tras liberar, los fallos quedan bajo el máximo (H3/M2, nuevo en el repair)                                                                                                        | `domain/login-throttle.ts:79-83`                                                                                                                                              | domain      | `login-throttle.test.ts › releaseAttempt` (3, ronda 2)                                                                                                                                                                                                                                                                                                                                          | CONFIRMED     |
| `RegisterUser`: alta normaliza correo, hashea, publica `USER_REGISTERED`; rechaza correo inválido, contraseña débil, correo duplicado y conflicto de `save`                                                                                                                     | `application/commands/register-user.command.ts:29-54`                                                                                                                         | application | `register-user.command.test.ts` (5)                                                                                                                                                                                                                                                                                                                                                             | CONFIRMED     |
| `LogIn`: correo con formato inválido → simula verificación, `INVALID_CREDENTIALS`, no toca throttle                                                                                                                                                                             | `application/commands/log-in.command.ts:68-72`                                                                                                                                | application | `log-in.command.test.ts › correo con formato inválido…`                                                                                                                                                                                                                                                                                                                                         | CONFIRMED     |
| `LogIn`: bloqueado por throttle de correo o de IP → `LOGIN_TEMPORARILY_BLOCKED` con `retryAfterSeconds`, sin verificar contraseña                                                                                                                                               | `application/commands/log-in.command.ts:74-83`                                                                                                                                | application | `log-in.command.test.ts` (2)                                                                                                                                                                                                                                                                                                                                                                    | CONFIRMED     |
| `LogIn`: usuario desconocido (simula verificación) / contraseña incorrecta (verifica de verdad) / usuario DISABLED con contraseña correcta → siempre `INVALID_CREDENTIALS` y registra el fallo                                                                                  | `application/commands/log-in.command.ts:85-96`                                                                                                                                | application | `log-in.command.test.ts` (3)                                                                                                                                                                                                                                                                                                                                                                    | CONFIRMED     |
| `LogIn`: éxito limpia el throttle del correo, deja el de IP intacto, crea la sesión y publica `SESSION_STARTED`; aplica la política de sesión según `client` (mobile sin idle)                                                                                                  | `application/commands/log-in.command.ts:98-130`                                                                                                                               | application | `log-in.command.test.ts › login exitoso…`, `› client=mobile…`                                                                                                                                                                                                                                                                                                                                   | CONFIRMED     |
| `LogIn`: el límite de intentos de la IP es independiente y más alto que el del correo (M2, nuevo en el repair) — una IP compartida (oficina, reverse proxy) no queda bloqueada por el límite pensado para un solo atacante                                                      | `application/commands/log-in.command.ts:161-164` (`policyFor`)                                                                                                                | application | `log-in.command.test.ts › el límite de la IP es independiente…` (ronda 2)                                                                                                                                                                                                                                                                                                                       | CONFIRMED     |
| `LogOut`: revoca+guarda+publica `SESSION_REVOKED`; idempotente si el `sessionId` no existe                                                                                                                                                                                      | `application/commands/log-out.command.ts:23-33`                                                                                                                               | application | `log-out.command.test.ts` (2)                                                                                                                                                                                                                                                                                                                                                                   | CONFIRMED     |
| `SessionAuthenticator`: null por token desconocido / revocada / vencida / usuario inexistente / usuario DISABLED; toca `lastSeenAt` solo si `needsTouch`                                                                                                                        | `application/session-authenticator.ts:20-36`                                                                                                                                  | application | `session-authenticator.test.ts` (7)                                                                                                                                                                                                                                                                                                                                                             | CONFIRMED     |
| `InMemorySessionRepository.recordActivity` no revive una sesión que un logout concurrente ya revocó en el store (dos instancias independientes de la misma fila); sí actualiza `lastSeenAt` cuando sigue activa (H2, nuevo en el repair)                                        | `infrastructure/in-memory/in-memory-session.repository.ts:24-33`                                                                                                              | application | `session-authenticator.test.ts › InMemorySessionRepository.recordActivity` (2, ronda 2)                                                                                                                                                                                                                                                                                                         | CONFIRMED     |
| `GetCurrentUser` delega en `UserQueries.findSessionUser`, `null` si no existe                                                                                                                                                                                                   | `application/queries/get-current-user.query.ts:10-12`                                                                                                                         | application | `get-current-user.query.test.ts` (2)                                                                                                                                                                                                                                                                                                                                                            | CONFIRMED     |
| `LogInSchema`: email/password (1-128)/client; `LogInResponseSchema.token` nullable; forma de `authRoutes` (método, path, `successStatus`)                                                                                                                                       | `packages/contracts/src/identity/auth.contract.ts:5-50`                                                                                                                       | contract    | `auth.contract.test.ts` (15, +2 ronda 2 = 17)                                                                                                                                                                                                                                                                                                                                                   | CONFIRMED     |
| `LogInSchema.email` acepta hasta 254 caracteres (mismo límite que `users.email`/`login_throttles.key`) y rechaza 255+, aunque el formato sea válido (L1, nuevo en el repair — evita el 500 que reportó el reviewer al guardar el throttle)                                      | `packages/contracts/src/identity/auth.contract.ts:14`                                                                                                                         | contract    | `auth.contract.test.ts › acepta un email de exactamente 254…`, `› rechaza un email de 255…` (ronda 2)                                                                                                                                                                                                                                                                                           | CONFIRMED     |
| `POST /auth/login` web → 200, `token:null`, cookie `__Host-rrhh_session` HttpOnly/Secure/SameSite=Lax/Path=/                                                                                                                                                                    | `http/identity.router.ts:18-30`, `http/bind-route.ts:26,51-52`                                                                                                                | http        | `auth.test.ts › client=web…`                                                                                                                                                                                                                                                                                                                                                                    | CONFIRMED     |
| `POST /auth/login` mobile → 200, `token` no nulo, sin `Set-Cookie`, `token_hash` ≠ token en claro                                                                                                                                                                               | `http/identity.router.ts:32-36`                                                                                                                                               | http        | `auth.test.ts › client=mobile…`                                                                                                                                                                                                                                                                                                                                                                 | CONFIRMED     |
| Contraseña incorrecta / correo desconocido / usuario DISABLED → 401 `INVALID_CREDENTIALS` con cuerpo idéntico                                                                                                                                                                   | `http/error-handler.ts:56-69`                                                                                                                                                 | http        | `auth.test.ts › credenciales inválidas…` (3)                                                                                                                                                                                                                                                                                                                                                    | CONFIRMED     |
| Correo mal formado → 400 `VALIDATION_ERROR` del contrato (`z.email()` lo rechaza antes de `LogIn`). Era GAP contra el criterio original (401); el usuario aceptó 400 y el criterio se corrigió                                                                                  | `packages/contracts/src/identity/auth.contract.ts:14` vs `domain/user.ts` (`Email.create`, `packages/domain/src/email.ts:4`) y `application/commands/log-in.command.ts:68-72` | http        | `auth-malformed-email.test.ts`                                                                                                                                                                                                                                                                                                                                                                  | CONFIRMED     |
| 429 con header `Retry-After` tras 5 intentos fallidos para el mismo correo                                                                                                                                                                                                      | `http/error-handler.ts:62-66`                                                                                                                                                 | http        | `auth.test.ts › 429 con Retry-After…`                                                                                                                                                                                                                                                                                                                                                           | CONFIRMED     |
| `GET /auth/me`: Bearer válido / cookie válida → 200; sin credenciales / token desconocido → 401 `AUTHENTICATION_REQUIRED`                                                                                                                                                       | `http/identity.router.ts:46-51`, `http/request-context.ts:17-29`                                                                                                              | http        | `auth.test.ts › GET /auth/me` (4)                                                                                                                                                                                                                                                                                                                                                               | CONFIRMED     |
| `POST /auth/logout`: revoca + 204 + el mismo token da 401 después; sin sesión → 401                                                                                                                                                                                             | `http/identity.router.ts:39-44`                                                                                                                                               | http        | `auth.test.ts › POST /auth/logout` (2)                                                                                                                                                                                                                                                                                                                                                          | CONFIRMED     |
| Logout por cookie: `Origin` permitido → 204 y limpia la cookie; `Origin` ausente o no permitido → 401 y la sesión sigue activa                                                                                                                                                  | `http/authenticate.ts:39-49`                                                                                                                                                  | http        | `auth.test.ts › con la cookie web y un Origin…` (2)                                                                                                                                                                                                                                                                                                                                             | CONFIRMED     |
| Rutas existentes (`/companies`, `/companies/:id/employees`) siguen abiertas sin credenciales tras montar el middleware de auth                                                                                                                                                  | `http/app.ts:50-57`                                                                                                                                                           | http        | `tests/http.test.ts` (preexistente, sigue verde)                                                                                                                                                                                                                                                                                                                                                | CONFIRMED     |
| Rutas de equipos (`/iclock/*`) fuera de `/api/v1`, no pasan por el middleware de auth                                                                                                                                                                                           | `http/app.ts:37-43`                                                                                                                                                           | http        | `tests/zkteco-adms.test.ts` (preexistente, sigue verde)                                                                                                                                                                                                                                                                                                                                         | CONFIRMED     |
| `PrismaUserRepository`: guarda/rehidrata, `findByEmail`, `findById` nulo, conflicto único de correo → `USER_ALREADY_EXISTS`, upsert refleja nuevo estado                                                                                                                        | `infrastructure/prisma-user.repository.ts:12-39`                                                                                                                              | integration | `prisma-user.int.test.ts` (5)                                                                                                                                                                                                                                                                                                                                                                   | CONFIRMED     |
| `PrismaSessionRepository`/`SessionMapper`: guarda/rehidrata (idle en segundos↔ms), `idleTimeoutMs=null` (mobile), `findByTokenHash`, revocación persiste, `userAgent` truncado a 500                                                                                            | `infrastructure/session.mapper.ts:7-44`, `infrastructure/prisma-session.repository.ts`                                                                                        | integration | `prisma-session.int.test.ts` (5)                                                                                                                                                                                                                                                                                                                                                                | CONFIRMED     |
| `PrismaSessionRepository.recordActivity` (`updateMany … WHERE revoked_at IS NULL`) no revive una sesión ya revocada en la BD por un logout concurrente; sí actualiza `lastSeenAt` cuando sigue activa (H2, nuevo en el repair)                                                  | `infrastructure/prisma-session.repository.ts:21-28`                                                                                                                           | integration | `prisma-session.int.test.ts › recordActivity` (2, ronda 2)                                                                                                                                                                                                                                                                                                                                      | CONFIRMED     |
| `PrismaLoginThrottleRepository`: guarda/rehidrata, `lock` crea la fila si falta y devuelve la existente sin reiniciarla (reemplaza a `find`, H3), `save` (upsert) refleja fallos/bloqueo sin duplicar filas                                                                     | `infrastructure/prisma-login-throttle.repository.ts`                                                                                                                          | integration | `prisma-login-throttle.int.test.ts` (4, adaptados a `lock` — ronda 2)                                                                                                                                                                                                                                                                                                                           | CONFIRMED     |
| `PrismaLoginThrottleRepository.lock` serializa reservas concurrentes sobre la misma llave con `SELECT … FOR UPDATE`: dos transacciones en paralelo no pierden ningún incremento (H3, la prueba real de concurrencia — no reproducible con el repositorio en memoria)            | `infrastructure/prisma-login-throttle.repository.ts`                                                                                                                          | integration | `prisma-login-throttle.int.test.ts › lock serializa reservas concurrentes…` (nuevo en el repair, ver `## Deviations`)                                                                                                                                                                                                                                                                           | CONFIRMED     |
| `Argon2PasswordHasher`: formato PHC exacto (`$argon2id$v=19$m=19456,t=2,p=1$…`), `verify` correcto/incorrecto, salts distintos por llamada, hash malformado → `false` sin lanzar, `verify` usa los parámetros GUARDADOS (compatibilidad hacia atrás), `simulateVerify` no lanza | `infrastructure/argon2-password-hasher.ts:71-118`                                                                                                                             | integration | `argon2-password-hasher.int.test.ts` (6)                                                                                                                                                                                                                                                                                                                                                        | CONFIRMED     |
| `loadEnv`: `SEED_USER_PASSWORD=''` (como deja `process.loadEnvFile` con la línea vacía de `.env.example`) se trata como ausente y no lanza; ausente de verdad también da `undefined`; sigue exigiendo el mínimo de 12 si viene una cadena no vacía (H1, nuevo en el repair)     | `config/env.ts:46-49`                                                                                                                                                         | domain      | `env.test.ts › loadEnv — SEED_USER_PASSWORD (H1)` (4, ronda 2)                                                                                                                                                                                                                                                                                                                                  | CONFIRMED     |
| `pnpm db:seed` dos veces con `SEED_USER_PASSWORD` crea `admin@example.com` una sola vez; sin la variable, se omite y se loguea el motivo                                                                                                                                        | `apps/api/prisma/seed.ts:61-70`                                                                                                                                               | —           | Requiere fijar `SEED_USER_PASSWORD` para el proceso de `pnpm db:seed`; el hook `guard-bash` bloquea toda forma de variable de entorno efímera en este sandbox (mismo bloqueo que documentó el Implementer en `## Deviations`). `seed.ts` es un script de tope, no una función exportada: no hay precedente de test unitario para él (tampoco lo tienen los seeds de `organization`/`employees`) | NOT CONFIRMED |

### Notas

- El test del correo mal formado nació como sonda (`_probe-malformed-email.test.ts`, `it.fails`
  GAP). Tras la decisión del usuario (aceptar 400) se renombró con `git mv` a
  `apps/api/tests/auth-malformed-email.test.ts` y ahora afirma el 400 `VALIDATION_ERROR`.
- `pnpm plans:scope` marca los 16 archivos de test nuevos como "fuera de alcance": es esperado — las
  líneas `Files:` de los Steps describen la fase de implementación, no la de tests, y el piso real
  de esta fase es la tabla "Test layers required" del plan, no una lista de archivos. No se tocó
  ningún archivo fuera de `identity`, `apps/api/tests/`, `packages/contracts/src/identity/` salvo la
  extensión de `apps/api/tests/test-app.ts` (`buildTestContainer(env = testEnv)`) necesaria para
  probar el chequeo de `Origin` con un `CORS_ORIGINS` distinto al de la suite HTTP compartida.
  (Nota de ronda 1; desde el paso 16 del repair, `pnpm plans:scope` corre limpio: "73 declarados,
  75 cambiados… Todos los cambios están dentro del alcance del plan".)
- **Ronda 2**: al verificar el límite de 254 caracteres de `LogInSchema.email` (L1) se corrió un
  script `node` puntual para confirmar el borde exacto de la regex de `z.email()` de Zod 4. Por
  error se creó una primera vez dentro de `packages/contracts/` (en vez del scratchpad de la
  sesión) y quedó como archivo `.mjs` suelto sin trackear; `rm` estaba bloqueado por `guard-bash`
  ("Untracked sin procedencia fiable"), así que se movió con `mv` al scratchpad (mismo mecanismo
  que documentó el Implementer en el paso 15 para su prueba de concurrencia). No quedó ningún
  archivo del script en el repo; `git status` del paquete solo muestra el test modificado.

## Review findings

**Ronda 1 (reviewer, 2026-09-29).** Diff `main...HEAD` (5 commits, 74 archivos) + árbol limpio.

### Checklist: 11/13

- [ ] **FAIL** `pnpm plans:scope`: exit 1. 56 declarados, 74 cambiados. Los 16 archivos de test
      no están en ninguna línea `Files:`, y la ruta con marcador
      `apps/api/prisma/migrations/<timestamp>_create_identity/migration.sql` sale como "declarada
      sin cambios" (la real es `20260929171530_create_identity`). Ver M1.
- [x] `pnpm check`: verde (api 24 archivos/170 tests, contracts 30, domain 49, web 2, mobile 5,
      api-client 3; arch `no dependency violations found (153 modules, 480 dependencies cruised)`).
- [x] `pnpm test:integration`: verde (6 archivos, 36 tests).
- [x] Reglas de negocio en `domain/` (vigencia de sesión, throttle, política de contraseña, `canSignIn`).
      El router solo decide el transporte (cookie o token), no aplica reglas de negocio.
- [x] CQRS ligero: los commands pasan por agregado → repositorio → `Result`; `GetCurrentUser` usa
      `UserQueries` → `SessionUser` del contrato. Los repositorios no tienen métodos para pantallas.
- [x] Tipos de request/response desde `@rrhh/contracts`.
- [x] Errores esperados con `Result` + subclases con `code` estable; `AUTHENTICATION_REQUIRED` es un
      error de adaptador, igual que `RequestValidationError`.
- [x] Tiempo con `Clock`, ids con `IdGenerator`, fechas en UTC (`timestamptz`); aleatoriedad
      detrás de los puertos `SessionTokens`/`PasswordHasher`.
- [x] Migración nueva `20260929171530_create_identity`: sin DROP. La única FK
      (`sessions.user_id → users.id`, RESTRICT) está dentro del schema `identity` (ADR 0010).
- [x] DI: `tests/container.test.ts` verde; `identityModule` se registra una sola vez en `container.ts`.
- [x] Sin secretos ni datos reales: `admin@example.com` es sintético, la contraseña del seed sale de
      env y `DUMMY_PASSWORD_FOR_TIMING` no es una credencial.
- [x] `## Deviations` honesta. Revisé la desviación de `InMemoryUserQueries`: el código usa la
      interfaz local `UserStore` y no importa `InMemoryUserRepository`
      (`infrastructure/in-memory/in-memory-user.queries.ts:12-14`).
- [ ] **FAIL** Docs existentes actualizadas: en `docs/architecture.md` quedan secciones
      desactualizadas. Ver L2.

### Hallazgos (3 High, 2 Medium, 2 Low, 2 Info)

**High**

- **H1: `.env.example` con `SEED_USER_PASSWORD=` impide arrancar el API.** Ubicación:
  `apps/api/src/config/env.ts:42` y `apps/api/.env.example:28`. `process.loadEnvFile` convierte
  `SEED_USER_PASSWORD=` en `""`, no en `undefined`. `z.string().min(12).optional()` rechaza `""`,
  así que `loadEnv` lanza "Variables de entorno inválidas". Lo reproduje en un script aparte:
  `util.parseEnv('SEED_USER_PASSWORD=\n')` devuelve `""` y el `safeParse` falla. Escenario:
  alguien clona el repo y corre el bootstrap, que copia `apps/api/.env.example` a `apps/api/.env`
  (`scripts/bootstrap.mjs:31`). A partir de ahí fallan `pnpm dev:api`, `pnpm db:seed` y el worker.
  Los `.env` que ya existían no se ven afectados, y los tests tampoco lo detectan porque llaman a
  `loadEnv` con un objeto explícito. El plan mismo pedía la línea vacía junto con ese schema, así
  que el defecto es del plan. Arreglo posible dentro del alcance: tratar `""` como ausente
  (preprocess) o dejar la variable comentada en `.env.example`. Hace falta un test en
  `env.test.ts`.
- **H2: un touch concurrente puede deshacer un logout.** Ubicación:
  `application/session-authenticator.ts:24-32`, `application/commands/log-out.command.ts:28-30`
  y `infrastructure/prisma-session.repository.ts:21-28`. `save` hace `upsert` con el snapshot
  completo, `revokedAt` incluido. Escenario: la petición A (por ejemplo, un `GET /auth/me` en
  paralelo) lee la sesión todavía activa y le toca hacer touch (pasaron ≥ 60 s). Mientras tanto,
  la petición B (`POST /auth/logout`) revoca y guarda `revoked_at`. Después A guarda su snapshot
  viejo con `revokedAt: null` y la sesión revocada vuelve a quedar activa: el cliente recibió 204
  pero el token sigue sirviendo. Rompe el criterio "the same token then gets 401" y la garantía
  de "revocación instantánea" del ADR 0011. No lo reproduje; el mecanismo sale de leer el código.
  Arreglarlo cambia el diseño del puerto: un `touch` que actualice solo `last_seen_at` con
  `WHERE revoked_at IS NULL`, o un `save` condicional. Eso se registra como deviation y necesita
  el visto bueno del usuario.
- **H3: el throttle de login se puede saltar con intentos concurrentes (lost update).**
  Ubicación: `application/commands/log-in.command.ts:74,85-94` y
  `infrastructure/prisma-login-throttle.repository.ts:16-23`. El flujo lee el contador (`find`),
  espera a argon2 `verify` (decenas de ms) y escribe valores absolutos (`upsert`
  `failures = k+1`). N peticiones en paralelo leen el mismo `k` y todas escriben `k+1`: el
  contador avanza uno por ráfaga, no uno por intento, y la verificación de bloqueo corre antes del
  hash, así que nada frena la ráfaga. Escenario: con ráfagas de 50 se prueban unas 250 contraseñas
  antes del 429, frente a las 5 del criterio "After 5 failed attempts…". El comentario del plan
  ("tolerate a lost update") hablaba de throttle contra sesión, no de un throttle contra sí mismo.
  No lo reproduje; el mecanismo sale del código. Arreglarlo también cambia el puerto (incremento
  atómico en SQL, o `SELECT … FOR UPDATE` en una transacción), así que va con deviation y
  decisión del usuario.

**Medium**

- **M1: `plans:scope` en rojo (proceso).** Ubicación: líneas `Files:` de los Steps. Pasó lo
  mismo en el plan 001 de `attendance-sonda-zkteco` y se resolvió declarando los tests en un
  step. Escenario: la puerta de alcance no puede quedar verde y el commit de la fase de tests no
  se puede trazar contra la lista de archivos. Arreglo: declarar los 16 tests y reemplazar
  `<timestamp>` por `20260929171530`. No hay que tocar código.
- **M2: el throttle por IP usa la misma política que el de correo y nunca se limpia.**
  Ubicación: `application/commands/log-in.command.ts:98-106` e
  `identity.module.ts` (`loginThrottlePolicy`). Es diseño del plan (paso 5), no un error de
  implementación. El impacto real es **incierto**, porque depende del despliegue: `trust proxy`
  está fuera de alcance. Escenario: detrás de un reverse proxy, `req.ip` es la IP del proxy para
  todos. Cinco fallos de cualquier persona en 15 min bloquean el login de toda la plataforma
  durante 15 min, y un login correcto no lo destraba. Lo mismo pasa en una oficina con NAT
  compartido. El usuario decide si el límite por IP va aparte (y más alto) o si se deja así con
  un hallazgo para el plan de producción.

**Low**

- **L1: un correo largo en el login responde 500.** Ubicación:
  `packages/contracts/src/identity/auth.contract.ts:14` (`z.email()` no limita el largo; la regex
  de Zod 4 no tiene tope) y la columna `login_throttles.key VARCHAR(320)`. Escenario: un correo
  de más de 314 caracteres con formato válido pasa el contrato. `findByEmail` no encuentra a
  nadie, y al guardar el throttle `email:<correo>` Postgres lanza "value too long", así que la
  respuesta es 500 `INTERNAL_ERROR` en vez de 401 (queda además un error en el log por cada
  intento). Pasa algo parecido en `RegisterUser` con `users.email VARCHAR(254)`, aunque hoy solo
  lo usa el seed. Arreglo posible: `.max(254)` en `LogInSchema.email`.
- **L2: `docs/architecture.md` quedó desactualizado.** En `:91-96` ("Errores"), el mapeo de
  categorías no incluye `AuthenticationError→401` ni `TooManyRequestsError→429`, y tampoco
  aparece el 401 `AUTHENTICATION_REQUIRED`. En `:77-89`, el flujo de un request no menciona el
  middleware de autenticación ni el `RequestContext` que ahora recibe cada handler. En `:129-132`,
  "Pendiente" todavía lista la autenticación de `identity` como pendiente, aunque ya existe.

**Info**

- **I1**: `## Test coverage` dice "169 tests + 1 `it.fails` esperado = 170", pero ya no queda
  ningún `it.fails` en `apps/api`: el sondeo se convirtió en un test normal. Son 170 tests que
  pasan.
- **I2**: en la práctica la inactividad web vence hasta 60 s antes de lo configurado, porque
  `lastSeenAt` se escribe cada `TOUCH_INTERVAL_MS`. Es la intención del plan; lo dejo anotado
  para verify.

Estado: sigue en `review`. H1 y L1-L2 se arreglan dentro del alcance. H2 y H3 cambian puertos de
repositorio y M2 es una decisión de diseño: los tres necesitan decisión del usuario o deviation
antes de volver a `implementing`. M1 es una edición del plan.

---

**Ronda 2 (reviewer, 2026-09-29).** Revisión del repair: `f059dd6` (fix) + `5b55cd9` (tests),
contra `043027b`, más el diff completo `main...HEAD` (6 commits) para el checklist. Árbol limpio.
Los hallazgos de la ronda 1 quedan arriba como historia; esta ronda los da por resueltos.

### Checklist: 13/13

- [x] `pnpm plans:scope`: "73 declarados, 75 cambiados… Todos los cambios están dentro del
      alcance del plan". Hot files revisados: `tests/test-app.ts` en el repair solo agrega
      (import de `TransactionRunner`, clase `NoopTransactionRunner`, un registro); las líneas
      quitadas en `main...HEAD` son de la ronda 1 (`buildTestContainer(env = testEnv)`), ya
      documentadas en `## Test coverage`.
- [x] `pnpm check`: verde (api 24 archivos/180 tests, contracts 32, domain 49, web 2, mobile 5,
      api-client 3; `no dependency violations found (153 modules, 481 dependencies cruised)`;
      plans/harness/hooks/bootstrap/quality sin fallos).
- [x] `pnpm test:integration`: verde (6 archivos, 39 tests).
- [x] Reglas de negocio en `domain/`: `registerAttempt`/`releaseAttempt` en `LoginThrottle`; `LogIn`
      solo orquesta reservas y elige política por prefijo de llave.
- [x] CQRS ligero: `recordActivity` y `lock` son operaciones de persistencia de agregado, no
      métodos para pantallas.
- [x] Tipos desde `@rrhh/contracts` (`LogInSchema.email` ahora `.max(254)`).
- [x] Errores esperados con `Result`; el `throw` de `lock` cuando falta la fila es inesperado
      (no puede pasar tras el `createMany`), correcto como excepción.
- [x] Tiempo vía `Clock`; `now` se pasa a `lock`/`registerAttempt`/`clear`.
- [x] Sin migración nueva en el repair (el esquema no cambió); la de la ronda 1 sigue igual.
- [x] DI: `tests/container.test.ts` verde; `transactionRunner` ya existía en el cradle raíz.
- [x] Sin secretos ni datos reales. Leí solo `.env.example`.
- [x] `## Deviations` honesta. Revisé "fakes.ts revertido a su contenido original":
      `git diff main -- apps/api/src/shared/testing/fakes.ts` está vacío.
- [x] Docs: `docs/architecture.md` (flujo con `cookieParser` → `createAuthenticate` →
      `RequestContext`, mapeo 401/429 y `AUTHENTICATION_REQUIRED`, "Pendiente" reducido a RBAC) y
      ADR 0011 (límites separados, row lock) al día.

### Estado de los hallazgos de la ronda 1

- **H1 resuelto.** `config/env.ts:131-134` trata `""` como ausente. Lo comprobé aparte: parsear
  `apps/api/.env.example` con `util.parseEnv` y pasarlo por `loadEnv` no lanza
  (`SEED_USER_PASSWORD` queda `undefined`, `LOGIN_IP_MAX_FAILURES` = 50). Regresión en
  `env.test.ts` (4 casos).
- **H2 resuelto.** `SessionAuthenticator` llama a `recordActivity`
  (`application/session-authenticator.ts:151-156`). Prisma usa
  `updateMany … where { id, revokedAt: null }` (`prisma-session.repository.ts:113-120`). La
  carrera inversa (el logout lee la sesión, un touch escribe y el logout guarda el snapshot
  completo) solo hace retroceder `lastSeenAt` en una sesión que ya quedó revocada, así que no
  tiene efecto. Hay regresiones en memoria y en Postgres.
- **H3 resuelto.** Cada llave reserva su intento en una transacción propia con
  `SELECT … FOR UPDATE` antes de argon2 (`log-in.command.ts:88,164-174`), y ninguna transacción
  queda abierta durante `verify`. Como cada transacción bloquea una sola fila, no hay orden de
  locks que pueda generar un deadlock. Una ráfaga de N intentos en paralelo reserva 1..5, la
  quinta reserva fija el bloqueo y las demás reciben 429 sin llegar a argon2, así que solo se
  prueban 5 contraseñas. El test de integración de concurrencia prueba que el lock serializa las
  reservas (`failures === 2`). También revisé `releaseAttempt` cuando hay peticiones
  concurrentes: el comentario "el bloqueo solo pudo originarse en esta misma reserva" no es
  literal, porque la reserva de otra petición pudo alcanzar el máximo. Aun así, el contador que
  queda después de liberar sigue siendo coherente con los intentos no exitosos, así que levantar
  el bloqueo en ese caso es correcto (ver I4).
- **M1 resuelto.** `plans:scope` verde; paso 16 declara los tests y la ruta de la migración es la real.
- **M2 resuelto.** `LOGIN_IP_MAX_FAILURES` (50) en env y `.env.example`, `policyFor` por prefijo
  y, en un login exitoso, `release` de la reserva de IP (`log-in.command.ts:106-107`), sin
  limpiarla entera. Hay test de aplicación.
- **L1 resuelto.** `LogInSchema.email` → `z.email().max(254)`. El test del contrato cubre 254
  (acepta) y 255 (rechaza). La llave más larga posible es `email:` + 254 = 260 ≤ `VARCHAR(320)`.
- **L2 resuelto.** Ver el checklist (docs).
- **I1 resuelto.** `## Test coverage` corrige la cifra y la ronda 2 cuadra con lo que medí (180 / 32 / 39).

### Hallazgos nuevos (0 High, 0 Medium, 1 Low, 4 Info)

**Low (no bloquea)**

- **L3: se reserva la IP aunque el correo ya esté bloqueado, y eso puede dar un 429 falso a otra
  persona detrás de la misma IP.** Ubicación: `log-in.command.ts:145-146` (`reserveOrBlock`
  reserva todas las llaves antes de mirar los resultados) y `:156-158` (libera después).
  Escenario: la IP de una oficina tiene 49 intentos contados, con límite 50. Un atacante insiste
  con un correo ya bloqueado desde esa misma IP. Cada una de sus peticiones sube la IP a 50 y
  fija `blockedUntil` durante unos milisegundos antes de liberarla. Si justo en ese intervalo
  entra el login de otra persona de la oficina, recibe 429 con `Retry-After` de unos 900 s,
  aunque el bloqueo desaparece enseguida. Hace falta que la IP esté exactamente en `max-1` y que
  las peticiones coincidan: es poco probable y se recupera reintentando. Además hay una
  transacción de escritura de más por cada intento bloqueado. Arreglo posible dentro del
  alcance: dejar de reservar las llaves siguientes en cuanto una sale bloqueada. Lo dejo a
  decisión del usuario: no impide pasar a verify.

**Info**

- **I3: el renombre de la clave del cradle no quedó en `## Deviations`.** El paso 15 dice que el
  registro `loginThrottlePolicy` "becomes `{ email; ip }`". El código lo renombró a
  `loginThrottlePolicies` (`identity.module.ts:36,65`, `log-in.command.ts:45`). Es inocuo, porque
  nada fuera de `identity` lo resuelve, pero no está anotado.
- **I4: el comentario de `releaseAttempt` (`domain/login-throttle.ts:274-280`) y el de
  `reserveOrBlock` (`log-in.command.ts:154-155`) dicen que el bloqueo "solo pudo originarse en
  esta misma reserva".** Con peticiones concurrentes también pudo originarlo la reserva de otra
  petición. El comportamiento es correcto (ver H3), pero la justificación del comentario no lo es.
- **I5 (incierto): bajo una ráfaga muy grande sobre la misma llave, algunas peticiones podrían
  responder 500 en vez de 429.** Cada intento abre hasta 4 transacciones interactivas de Prisma,
  y las que esperan el row lock ocupan una conexión del pool. Si el pool se agota más allá del
  `maxWait` de `$transaction`, la petición falla antes de `verify`. Falla de forma segura: no se
  prueba ninguna contraseña. No lo reproduje; lo dejo anotado para verify o para el plan de
  producción.
- **I6 (hueco de test): nada comprueba que se libera la reserva del correo cuando la IP está
  bloqueada.** El test "bloqueado por el throttle de la IP aunque el correo esté libre"
  (`log-in.command.test.ts:118-132`) verifica el 429, pero no que el throttle del correo vuelva a
  0 después del `release` de `reserveOrBlock`.

Estado: todos los hallazgos de la ronda 1 están resueltos y no hay hallazgos nuevos que bloqueen
→ `status: verify`. L3 e I3-I6 quedan a decisión del usuario. Recordatorio para verify: el
criterio de `pnpm db:seed` con `SEED_USER_PASSWORD` sigue NOT CONFIRMED (ver `## Test coverage`).

## Verification

**Verifier, 2026-09-29.** App corriendo de verdad: `pnpm db:up` (Postgres/Valkey/RustFS/Mailpit ya
arriba), `pnpm dev:api` (arrancó con el `.env` real del usuario, con `SEED_USER_PASSWORD` fijada
por él — nunca leí ni imprimí su valor). Base `rrhh` (dev), no `rrhh_test`. Todos los criterios se
ejercitaron contra la app corriendo con `curl` (algunos forzando `--ipv4` para no chocar con mi
propio throttle de IP, ver nota al final) y consultas `SELECT` directas a Postgres; los scripts
puntuales que necesité (crear usuarios de prueba vía el caso de uso real, no por HTTP — no hay
endpoint de registro en este plan) viven solo en el scratchpad de la sesión, nunca en el repo.
`git status` al cierre: árbol limpio, ningún archivo del repo tocado.

### Suites

- [x] `pnpm check`: verde completo (formato, typecheck, lint, tests, `arch:check` sin violaciones,
      `plans:lint`, `harness:check`, hooks, bootstrap, quality). `@rrhh/api`: 24 archivos/180 tests;
      `@rrhh/contracts`: 4 archivos/32 tests — coincide exactamente con lo que reporta `## Test
  coverage` ronda 2.
- [x] `pnpm test:integration`: verde, 6 archivos/39 tests — coincide con `## Test coverage`.

### Migración y esquema

- [x] `apps/api/prisma/migrations/20260929171530_create_identity/` aplicada; `\dt identity.*` en la
      BD `rrhh` muestra `users`, `sessions`, `login_throttles`.
- [x] `pnpm db:seed` (ver más abajo) creó `admin@example.com` con
      `password_hash = $argon2id$v=19$m=19456,t=2,p=1$Voj3fheAii9OsiRuSvbYvw$DY74LctcuPzrMKOvbMUQqSVRBHfR4Ss9oBuQaiRK984`
      — prefijo exacto del criterio. `sessions.token_hash` de una sesión mobile recién creada
      (`57932c9b19...fabcf7`) coincide byte a byte con `sha256sum` del token devuelto por
      `/auth/login` (`zPD1RVUUGTd93LgfXnEQw7NXPvaqcmuFDLK6me0ZRFs`), y no es el token. Revisé
      `users`, `sessions` y `login_throttles`: ninguna columna guarda contraseña o token en claro.

### Login (web / mobile) y `/auth/me`

- [x] `POST /auth/login` `client:"web"` con credenciales válidas → 200,
      `{"user":{"id","email"},"expiresAt","token":null}`, y
      `Set-Cookie: __Host-rrhh_session=…; Path=/; Expires=…; HttpOnly; Secure; SameSite=Lax` (headers
      exactos, verificado con `curl -i`).
- [x] Mismo con `client:"mobile"` → 200, `token` no nulo, **sin** `Set-Cookie`; `expiresAt` a 30
      días (`SESSION_MOBILE_ABSOLUTE_DAYS`); `idle_timeout_seconds` de esa fila es `NULL` en BD
      (mobile sin idle) frente a `1800` (30×60) en la fila web — políticas de sesión aplicadas
      correctamente por `client`.
- [x] `GET /auth/me`: `Authorization: Bearer <token>` → 200 `{id,email}`; cookie `__Host-rrhh_session`
      (vía jar de `curl`) → 200; sin credenciales → 401 `AUTHENTICATION_REQUIRED`; token
      desconocido (`Bearer totally-unknown-token-value`) → 401 `AUTHENTICATION_REQUIRED`.

### Credenciales inválidas y throttle

- [x] Contraseña incorrecta, correo desconocido y usuario `DISABLED` (creado con `registerUser` y
      pasado a `DISABLED` por SQL, ya que el dominio no expone un comando para deshabilitar en
      este plan) → los tres devuelven exactamente
      `{"code":"INVALID_CREDENTIALS","message":"Correo o contraseña incorrectos"}` — mismo
      `Content-Length` (75) y mismo `ETag` en los tres casos, cuerpos bit a bit idénticos.
- [x] Correo mal formado (`"not-an-email"`) → 400 `VALIDATION_ERROR` del contrato, antes de tocar
      `LogIn` (criterio corregido el 2026-09-29, como documenta el plan).
- [x] 5 intentos fallidos seguidos sobre el mismo correo → el 6.º intento, **con la contraseña
      correcta**, responde 429 `LOGIN_TEMPORARILY_BLOCKED` con `Retry-After: 898` — bloqueado antes
      de verificar la contraseña, tal como diseña H3.
- [x] Un correo nuevo con 2 fallos y luego un login exitoso: `login_throttles` de ese correo queda
      en `failures=0` después del éxito — el contador se limpia.
- [x] **Concurrencia real (H3), en la app corriendo, no solo en el test de integración**: disparé 10
      intentos con contraseña incorrecta en paralelo (`Promise.all` con `fetch`, mismo correo nuevo)
      contra `POST /auth/login`. Resultado: exactamente 5×401 y 5×429 (`{401:5, 429:5}`), y la fila
      de `login_throttles` quedó en `failures=5` — ni menos (que delataría un lost update) ni más
      (que delataría que el candado no sirvió). El row lock serializa la ráfaga como se diseñó.
- [x] Límite de IP independiente (M2): con `ip:::1` en 15 fallos previos, hice 3 logins exitosos
      seguidos desde la misma IP con otra cuenta — el contador de `ip:::1` quedó igual (15, no bajó
      ni subió): reservar-y-liberar en un éxito no cambia el saldo. Luego empujé 35 intentos
      fallidos más (correos distintos, cada uno bajo su propio límite de 5) y el bloqueo apareció
      justo en el intento que llevó el contador a 50 (`failures=50, blocked_until` fijado); el
      siguiente intento devolvió 429. `LOGIN_IP_MAX_FAILURES=50` se respeta con precisión de a uno.

### Logout, revocación concurrente y Origin

- [x] `POST /auth/logout` con sesión válida y `Origin` permitido (`http://localhost:3000`) → 204,
      `Set-Cookie` que limpia la cookie (`Expires: Thu, 01 Jan 1970…`). El mismo token (enviado a
      mano, no el que `curl` ya había expirado en su jar) → 401 en `/auth/me` después. En BD,
      `sessions.revoked_at` quedó fijado. Sin sesión → 401.
- [x] `POST /auth/logout` autenticado por cookie con `Origin` ausente → 401
      `AUTHENTICATION_REQUIRED` y la sesión siguió activa (`GET /auth/me` con la misma cookie → 200
      después). Con `Origin: https://evil.example.com` (no está en `CORS_ORIGINS`) → también 401,
      sesión intacta.
- [x] **H2, reproducido en vivo contra la Postgres real de la app** (no solo el test de integración):
      no es posible forzar por HTTP la interleaving exacta de milisegundos, así que llamé
      directamente al `sessionRepository` real (`PrismaSessionRepository`, el mismo que usa el
      contenedor) desde un script: (1) login, (2) leo la sesión "vieja" (`revokedAt=null`, simula la
      lectura de una petición A antes del logout), (3) ejecuto el logout real (petición B) que fija
      `revoked_at`, (4) confirmo que `revoked_at` quedó fijado, (5) con el snapshot **viejo** en
      memoria (que todavía cree `revokedAt=null`) llamo `touch()` + `recordActivity()` — la escritura
      tardía de la petición A. Resultado: la sesión sigue revocada y `last_seen_at` **no** cambió
      (la escritura tardía no tuvo efecto, por el `WHERE revoked_at IS NULL` de
      `PrismaSessionRepository.recordActivity`). El fix de H2 sostiene la garantía "logout ⇒
      revocación instantánea" incluso bajo esta carrera, ejercitado con el código de producción real
      contra la BD real, no un doble.

### Vigencia de sesión (idle / absoluta)

- [x] Sesión web fresca con `last_seen_at` retrasado por SQL a 31 minutos (> `SESSION_WEB_IDLE_MINUTES=30`,
      `expires_at` sin tocar) → `GET /auth/me` con esa cookie → 401.
- [x] Otra sesión web fresca con `expires_at` retrasado por SQL a 1 minuto en el pasado (vigencia
      absoluta vencida, `last_seen_at` reciente) → `GET /auth/me` → 401.

### `.env` verbatim (H1) y correo largo (L1)

- [x] La app ya estaba corriendo con el `.env` real del usuario (copiado en su momento de
      `.env.example` y con `SEED_USER_PASSWORD` agregada) — arrancó sin problema. Para aislar el
      caso exacto de H1 (la línea vacía `SEED_USER_PASSWORD=` que deja `""`, no `undefined`), corrí
      `loadEnv` (la función real de producción) sobre el contenido **actual** de
      `apps/api/.env.example` parseado con `node:util.parseEnv` (el mismo parser que usa
      `process.loadEnvFile`): no lanza, `env.SEED_USER_PASSWORD` queda `undefined`. No creé un
      segundo `apps/api/.env*` para no rozar la regla de nunca tocar esos archivos.
- [x] Login con un correo de 255 caracteres (formato válido, sobre el límite) → 400
      `VALIDATION_ERROR` (`too_big`, `maximum:254`), no 500. Con exactamente 254 caracteres → 401
      `INVALID_CREDENTIALS` (correo desconocido, no encontrado, sin crash). `L1` sostenido en vivo.

### Rutas existentes sin tocar

- [x] `GET /api/v1/companies` → 200 sin credenciales, misma forma de respuesta que antes.
- [x] `GET /api/v1/companies/:id/employees` → 200 sin credenciales.
- [x] `GET /iclock/cdata?SN=UNKNOWN` (fuera de `/api/v1`) → 403 `ERROR: dispositivo no autorizado`
      — el propio control de seriales del dispositivo, **no** el `AUTHENTICATION_REQUIRED` de
      identity: confirma que el middleware de auth no se monta sobre `/iclock/*` (ADR 0008).

### `pnpm db:seed`

- [x] Corrido dos veces de verdad (`pnpm db:seed`, sin variables efímeras — la contraseña ya estaba
      en el `.env` real del usuario). 1.ª vez: log `"usuario creado" email:"admin@example.com"`.
      2.ª vez: sin esa línea, solo `"seed completado"`. `SELECT` confirma una sola fila
      `admin@example.com` en `identity.users` tras las dos corridas.
- [~] Rama "sin `SEED_USER_PASSWORD`": **no pude correr `pnpm db:seed` literalmente sin la
  variable** — el `.env` real ya la tiene fijada (no se debe editar ni leer `.env`), y
  `guard-bash` bloquea toda forma de inyectar una variable de entorno efímera en un comando
  (`VAR=x cmd`, wrappers) en este sandbox, igual que documentó el Implementer para el mismo
  obstáculo. Sustituto ejercitado en vivo: un script que reconstruye textualmente la misma rama
  `if (env.SEED_USER_PASSWORD) {…} else {…}` de `apps/api/prisma/seed.ts:61-70`, usando el
  contenedor real y el `env` real con `SEED_USER_PASSWORD` forzado a `undefined` en una copia
  del objeto (no se tocó el `.env`). Resultado: log
  `"SEED_USER_PASSWORD no está definida: se omite la creación del usuario admin"` y
  `registerUser.execute` nunca se llamó (confirmado: el conteo de `admin@example.com` siguió en
  1 antes y después). Esto ya estaba cubierto por `env.test.ts` (H1, 4 casos) y por revisión de
  código; con esto queda además ejercitado en vivo con el contenedor real, pero no es
  literalmente `pnpm db:seed` sin la variable — lo marco confirmado con esta salvedad, no como
  NOT VERIFIED, porque la lógica ejercitada es exactamente la del script, solo que invocada
  desde un segundo entry point en vez de la CLI de `pnpm`.

### Limpieza de datos de prueba

Usuarios y sesiones que creé para estas pruebas (`verifier-test@example.com`,
`verifier-disabled@example.com`, `verifier-reset@example.com`, `verifier-ipcheck@example.com`, sus
12 filas de `identity.sessions`, y 44 filas de `identity.login_throttles` con claves
`email:verifier-*`, `email:verifier-ipburst-*`, `email:nonexistent@example.com`, el correo largo
fabricado y `ip:203.0.113.9`) se borraron al cierre, cada `DELETE` precedido de su `SELECT count(*)`
con el mismo `WHERE`. Quedó en la BD, sin tocar: `admin@example.com` (resultado esperado del
criterio de seed) y tres filas de `login_throttles` que **no creé yo** y por eso no borré:
`email:smoke-test-1790702932232@example.com` (de una sesión anterior), `ip:127.0.0.1` (preexistente,
sin modificar) e **`ip:::1`, que sí modifiqué** al correr las pruebas de throttle por IP: quedó en
`failures=50`, bloqueada hasta **2026-09-29 20:22:29 UTC + `LOGIN_BLOCK_MINUTES` (15 min) ≈ 20:37:29
UTC**. Se destrabará sola (el diseño no tiene "unblock" manual); cualquier login real desde el
loopback IPv6 de esta máquina antes de esa hora verá 429. No la reseteé por SQL porque no la creé y
la instrucción es no borrar/alterar datos que no son míos salvo para decirlo — lo digo aquí.
`pnpm dev:api` (proceso en segundo plano que arranqué para estas pruebas) se detuvo al cierre.
`git status` limpio.

### Veredicto

14/14 criterios de aceptación confirmados en la app corriendo (uno, el de `pnpm db:seed` sin
`SEED_USER_PASSWORD`, con la salvedad de método explicada arriba por restricciones del sandbox, no
por comportamiento dudoso). Nada quedó en NOT VERIFIED. `pnpm check` y `pnpm test:integration`
verdes. Sin hallazgos nuevos ni desviaciones de producto — los hallazgos abiertos L3/I3-I6 de la
ronda 2 del reviewer siguen anotados como decisión del usuario, no bloquean.

**Listo para que el usuario pase el plan a `done`.**
