---
status: testing
module: identity
min_implementer: mid
depends_on: ['001']
---

# 002 — Roles, permisos y protección de endpoints

## Context

**Today (after plan 001, `done`).** Every request gets an `Actor` (`{ userId, sessionId }`,
`apps/api/src/shared/application/actor.ts:2-5`) resolved by the global middleware
(`apps/api/src/http/authenticate.ts:20-54`), and `bindRoute` hands a `RequestContext` to each
handler (`apps/api/src/http/bind-route.ts:33-64`). Only `/auth/logout` and `/auth/me` require a
session (`requireActor`, `apps/api/src/http/request-context.ts:26-29`). The five business routes are
still open to anyone: `listCompanies`, `getCompany`, `createCompany`
(`packages/contracts/src/organization/company.contract.ts:36-52`) and `listEmployees`,
`registerEmployee` (`packages/contracts/src/employees/employee.contract.ts:46-56`).
`RouteDefinition` has no notion of access (`packages/contracts/src/http.ts:9-19`). The OpenAPI
document declares both session schemes plus `{}` globally, i.e. "auth optional"
(`packages/contracts/src/openapi.ts:46`), and its generic error response lists 400/401/404/409/500
but not 403 (`openapi.ts:52-55`); `openapi.json` is regenerated with
`pnpm --filter @rrhh/contracts openapi` (`packages/contracts/package.json:15`, snapshot at
`packages/contracts/src/openapi.test.ts:12`). The identity schema has `User`, `Session`,
`LoginThrottle` (`apps/api/prisma/schema.prisma:68-125`); there is no role data anywhere. The
companies read model lists every company with no filter (`apps/api/src/modules/organization/infrastructure/prisma-company.queries.ts:21-33`,
port `application/queries/company.queries.ts:7-10`, use case `list-companies.query.ts:7-13`,
in-memory `infrastructure/in-memory/in-memory-company.store.ts:41-56`). The seed creates
`admin@example.com` only (`apps/api/prisma/seed.ts:61-70`). The HTTP test container wires
in-memory identity adapters (`apps/api/tests/test-app.ts:39-79`); `tests/http.test.ts` calls the
business routes without credentials. The web page `apps/web/src/app/empresas/page.tsx` and the
mobile hook `apps/mobile/src/features/organization/hooks/use-companies.ts` call `listCompanies`
without a session.

**What we need.** README decisions 6, 13-16: a fixed role catalog with atomic permissions,
`(user, role, scope)` assignments managed by Admin holding over HTTP, every route declaring its
access in the contract (deny by default), 403 for missing permission, company-scoped routes
checked against the `:companyId` param, and `listCompanies` filtered to the caller's companies.
Only the holding and company scopes are enforced now (decision 13). Also the deferred finding
`plans/hallazgos/identity-throttle-reserva-ip.md` (decision 16).

**Approach.** Compared (a) checks written by hand inside each handler/use case and (b) access
declared in the contract and enforced once in `bindRoute`. Chose (b): it is the same DRY move
`bindRoute` already makes for validation (`bind-route.ts:28-32`), it makes an unprotected route a
type error (the field is required), and the same declaration feeds OpenAPI. Permissions are
resolved **once per request** at authentication: `SessionAuthenticator` loads the user's active
assignments and expands them through the role catalog into `grants` on the `Actor`, so revoking a
role takes effect on the next request. Pure helpers in `shared/application/actor.ts` answer "may
this actor do P (in company C)?". Row filtering is done by the use case that owns the read model
(`ListCompanies` receives the actor). The permission and role vocabulary is shared by contracts and
API, so it lives in `@rrhh/domain` as pure constants, like `EMPLOYEE_STATUSES`
(`packages/domain/src/employees/employee-status.ts:1-3`, ADR 0007); the role → permissions mapping
is identity's business rule and lives in `identity/domain/`.

**Imitated files.** Aggregate/repository/errors/command/mapper/Prisma/in-memory shapes: the
identity module of plan 001 (`apps/api/src/modules/identity/domain/session.ts`,
`domain/session.repository.ts`, `domain/errors.ts`, `application/commands/log-out.command.ts`,
`infrastructure/session.mapper.ts`, `infrastructure/prisma-session.repository.ts`,
`infrastructure/in-memory/in-memory-session.repository.ts`). Cross-module port + adapter:
`apps/api/src/modules/employees/application/ports/employer-directory.ts:10-18` and
`infrastructure/organization-employer-directory.ts:10-17` (ADR 0010 rule 2). Contract:
`packages/contracts/src/identity/auth.contract.ts`. Adapter HTTP error:
`apps/api/src/http/request-context.ts:16-24`, handled at `apps/api/src/http/error-handler.ts:50`.

## Out of scope

- Enforcing the **Jefe directo** (team) and **Colaborador** (self) scopes: they exist in the
  catalog but grant nothing and cannot be assigned yet (decision 13). No `managerId`, no
  `User.employeeId`.
- Creating/disabling users over HTTP, invitations, password reset (plan 003).
- Web and mobile login (plan 004, deferred by decision 9). **Consequence accepted**: after this
  plan `apps/web/src/app/empresas/page.tsx` and the mobile companies hook get 401 at runtime until
  plan 004; they must still compile.
- Configurable roles/permissions from a UI; a Nómina role.
- Field-level filtering of sensitive data (no sensitive fields exist yet).
- Audit log of assignment changes beyond `assigned_by`/`revoked_by` columns.
- Protecting `/health/*`, `/docs`, `/openapi.json` (non-production only) and `/iclock/*`
  (ADR 0008): they are not contract routes and stay as they are.
- Postgres RLS / multi-tenancy.

## Dependencies

- `identity-acceso/001` (`done`): `Actor`, `RequestAuthenticator`, `SessionAuthenticator`,
  `RequestContext`/`requireActor`, `AuthenticationRequiredError`, the `identity` schema and module.

## Steps

1. **Shared vocabulary: permissions and roles**
   - Files: `packages/domain/src/identity/access.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do: pure constants with a Spanish doc comment naming identity as owner (ADR 0007):
     - `PERMISSIONS = ['organization.companies:read', 'organization.companies:create', 'employees:read', 'employees:register', 'identity.users:read', 'identity.roles:manage'] as const`, `type Permission`.
     - `ROLES = ['HOLDING_ADMIN', 'HR', 'DIRECT_MANAGER', 'EMPLOYEE'] as const`, `type Role`.
     - `ROLE_SCOPES = ['HOLDING', 'COMPANY', 'TEAM', 'SELF'] as const`, `type RoleScope`.
     - Export from `index.ts` (`export * from './identity/access';`).
   - Observable result: `pnpm --filter @rrhh/domain typecheck` passes.

2. **Contracts: route access, role assignment and user routes**
   - Files: `packages/contracts/src/http.ts` (modify), `packages/contracts/src/organization/company.contract.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/src/identity/auth.contract.ts` (modify), `packages/contracts/src/identity/access.contract.ts` (create), `packages/contracts/src/index.ts` (modify)
   - Do:
     - `http.ts`: `export type RouteAccess = { readonly kind: 'public' } | { readonly kind: 'authenticated' } | { readonly kind: 'permission'; readonly permission: Permission; readonly companyParam?: string }` (import `Permission` from `@rrhh/domain`), plus helpers `publicAccess`, `authenticated` and `requires(permission, options?: { companyParam: string })` returning those literals. Add **required** `readonly access: RouteAccess` to `RouteDefinition` with a doc: "negado por defecto: toda ruta declara quién la puede llamar; `companyParam` nombra el parámetro de path cuya empresa debe estar en el alcance del actor".
     - Declare access on every existing route: `logIn` → public; `logOut`, `me` → authenticated; `listCompanies` → `requires('organization.companies:read')`; `getCompany` → `requires('organization.companies:read', { companyParam: 'companyId' })`; `createCompany` → `requires('organization.companies:create')`; `listEmployees` → `requires('employees:read', { companyParam: 'companyId' })`; `registerEmployee` → `requires('employees:register', { companyParam: 'companyId' })`.
     - `access.contract.ts` (group `accessRoutes`), all with `requires(...)`:
       - `listUsers` `GET /users` — `identity.users:read`; query `PageQuerySchema.extend({ search: z.string().trim().min(1).optional() })`; response `pageOf(UserListItemSchema)` with `UserListItemSchema = z.object({ id: z.uuid(), email: z.email(), status: z.enum(['ACTIVE', 'DISABLED']) }).meta({ id: 'UserListItem' })`.
       - `listRoleAssignments` `GET /users/:userId/role-assignments` — `identity.roles:manage`; response `z.array(RoleAssignmentSchema)` with `RoleAssignmentSchema = z.object({ id: z.uuid(), role: z.enum(ROLES), companyId: z.uuid().nullable(), assignedAt: z.iso.datetime() }).meta({ id: 'RoleAssignment' })` (active only).
       - `assignRole` `POST /users/:userId/role-assignments` — `identity.roles:manage`; body `z.object({ role: z.enum(ROLES), companyId: z.uuid().optional() })`; response `CreatedSchema`, 201.
       - `revokeRoleAssignment` `DELETE /users/:userId/role-assignments/:assignmentId` — `identity.roles:manage`; response `z.undefined()`, 204.
       - Params schemas without `.meta({ id })` (`openapi.ts` rejects that, lines 124-129).
     - `index.ts`: export the new file and add `access: accessRoutes` to `apiRoutes`.
   - Observable result: `pnpm --filter @rrhh/contracts typecheck` passes; removing `access` from any route is a type error.

3. **OpenAPI: per-operation security and 403**
   - Files: `packages/contracts/src/openapi.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do: global `security` becomes `[{ bearerAuth: [] }, { cookieAuth: [] }]` (no `{}`); in `operationFor`, public routes get `security: []`; permission routes get `'x-permission': route.access.permission` and, if `companyParam`, `'x-company-param'`; the `Error` response description adds "403 sin permiso". Adjust only the existing assertions in `openapi.test.ts` that pin the old global `security`; then regenerate the snapshot with `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: `pnpm --filter @rrhh/contracts test` green; `openapi.json` shows `security: []` on `/auth/login` and `x-permission` on business routes.

4. **Domain: role catalog, RoleAssignment, errors**
   - Files: `apps/api/src/modules/identity/domain/role-catalog.ts` (create), `apps/api/src/modules/identity/domain/role-assignment.ts` (create), `apps/api/src/modules/identity/domain/role-assignment.repository.ts` (create), `apps/api/src/modules/identity/domain/errors.ts` (modify)
   - Do:
     - `role-catalog.ts`: `ROLE_DEFINITIONS: Readonly<Record<Role, { scope: RoleScope; permissions: readonly Permission[]; assignable: boolean }>>` — `HOLDING_ADMIN`: scope `HOLDING`, all `PERMISSIONS`, assignable; `HR`: scope `COMPANY`, `['organization.companies:read', 'employees:read', 'employees:register']`, assignable (README decision 6: "everything about colaboradores"); `DIRECT_MANAGER`: `TEAM`, `[]`, not assignable; `EMPLOYEE`: `SELF`, `[]`, not assignable (decision 13). Comment why the last two are inert. Export `Grant = { permission: Permission; companyId: string | null }` (null = whole holding) and `grantsFor(assignments: readonly { role: Role; companyId: string | null }[]): Grant[]`.
     - `role-assignment.ts`: `RoleAssignmentId = Id<'RoleAssignment'>`; props `{ userId: UserId; role: Role; companyId: string | null; assignedAt: Date; assignedBy: UserId | null; revokedAt: Date | null; revokedBy: UserId | null }` (`assignedBy` null = seed/system). `static assign({ id, userId, role, companyId, assignedBy, now }): Result<RoleAssignment, RoleNotAssignableError | InvalidRoleScopeError>`: role must be `assignable`; `HOLDING` roles require `companyId === null`, `COMPANY` roles require a `companyId`. Records `ROLE_ASSIGNED = 'identity.role.assigned'`. `revoke(by, now)`: sets `revokedAt/revokedBy`, records `ROLE_REVOKED = 'identity.role.revoked'`, no-op if already revoked. `isActive` getter, `restore`, `snapshot`. No delete (ADR 0010 rule 1: kept for history).
     - `role-assignment.repository.ts`: `findById(id)`, `findActiveByUser(userId): Promise<RoleAssignment[]>`, `countActiveByRole(role): Promise<number>`, `save(assignment): Promise<void>`.
     - `errors.ts` add: `RoleNotAssignableError extends BusinessRuleViolationError` (`ROLE_NOT_ASSIGNABLE`, "Ese rol todavía no se puede asignar"); `InvalidRoleScopeError extends InvalidValueError` (`INVALID_ROLE_SCOPE`, "HOLDING_ADMIN no lleva empresa; HR requiere una empresa"); `RoleAlreadyAssignedError extends ConflictError` (`ROLE_ALREADY_ASSIGNED`); `RoleAssignmentNotFoundError extends NotFoundError` (`ROLE_ASSIGNMENT_NOT_FOUND`); `UserNotFoundError extends NotFoundError` (`USER_NOT_FOUND`); `LastHoldingAdminError extends BusinessRuleViolationError` (`LAST_HOLDING_ADMIN`, "No se puede quitar el último administrador del holding"); `AssignmentCompanyNotFoundError extends NotFoundError` (`COMPANY_NOT_FOUND`) and `AssignmentCompanyInactiveError extends BusinessRuleViolationError` (`COMPANY_INACTIVE`) — same codes as `apps/api/src/modules/employees/domain/errors.ts:11-25`.
   - Observable result: typecheck and `pnpm arch:check` (domain purity) pass.

5. **Actor grants and authorization helpers**
   - Files: `apps/api/src/shared/application/actor.ts` (modify)
   - Do: `Actor` gains `grants: readonly Grant[]` with `Grant = { permission: Permission; companyId: string | null }` defined here (shared; identity's `role-catalog.ts` imports this type instead of declaring its own). Pure helpers with Spanish docs: `hasPermission(actor, permission, companyId?: string): boolean` — without `companyId`: any grant with that permission; with it: a grant with that permission and `companyId === null || === companyId`. `companiesWith(actor, permission): 'ALL' | readonly string[]` — `'ALL'` if a holding-wide grant exists, else the distinct company ids.
   - Observable result: typecheck passes (every place building an `Actor` must now pass `grants`).

6. **Application: authenticator grants, assignment commands, user list**
   - Files: `apps/api/src/modules/identity/application/session-authenticator.ts` (modify), `apps/api/src/modules/identity/application/ports/company-directory.ts` (create), `apps/api/src/modules/identity/application/commands/assign-role.command.ts` (create), `apps/api/src/modules/identity/application/commands/revoke-role-assignment.command.ts` (create), `apps/api/src/modules/identity/application/queries/user.queries.ts` (modify), `apps/api/src/modules/identity/application/queries/list-users.query.ts` (create), `apps/api/src/modules/identity/application/queries/list-role-assignments.query.ts` (create)
   - Do:
     - `SessionAuthenticator`: add `roleAssignmentRepository` to deps; after the user check, `grantsFor(await findActiveByUser(user.id))` and return `{ userId, sessionId, grants }`.
     - `company-directory.ts`: `interface AssignableCompany { id: string; active: boolean }`, `interface CompanyDirectory { find(companyId: string): Promise<AssignableCompany | null> }` (shape of `employer-directory.ts:10-18`).
     - `AssignRole implements Command<{ userId; role: Role; companyId: string | null; assignedBy: string | null }, { id }>`; deps `userRepository, roleAssignmentRepository, companyDirectory, idGenerator, clock, eventBus`. Flow: user exists → else `UserNotFoundError`; `RoleAssignment.assign(...)` (propagate err); if `companyId` → directory: null → `AssignmentCompanyNotFoundError`, inactive → `AssignmentCompanyInactiveError`; an active assignment with same role+companyId → `RoleAlreadyAssignedError`; save; publish; `ok({ id })`.
     - `RevokeRoleAssignment implements Command<{ userId; assignmentId; revokedBy: string }, void>`; deps `roleAssignmentRepository, transactionRunner, clock, eventBus`. Inside `transactionRunner.run`: find → missing, other user's, or already revoked → `RoleAssignmentNotFoundError`; if role is `HOLDING_ADMIN` and `countActiveByRole('HOLDING_ADMIN') <= 1` → `LastHoldingAdminError`; revoke; save. Publish after. Comment: the count and the write share a transaction; two admins revoking each other concurrently is accepted as residual risk (documented, no lock).
     - `user.queries.ts`: add `listUsers(filters: PageQuery & { search?: string }): Promise<Page<UserListItem>>` and `listActiveRoleAssignments(userId: string): Promise<RoleAssignmentDto[] | null>` (null = user does not exist). `ListUsers` and `ListRoleAssignments` thin use cases (shape of `get-current-user.query.ts`); `ListRoleAssignments` returns `Result<RoleAssignmentDto[], UserNotFoundError>`.
   - Observable result: typecheck and `pnpm arch:check` pass.

7. **Organization: companies list filtered by the actor**
   - Files: `apps/api/src/modules/organization/application/queries/company.queries.ts` (modify), `apps/api/src/modules/organization/application/queries/list-companies.query.ts` (modify), `apps/api/src/modules/organization/infrastructure/prisma-company.queries.ts` (modify), `apps/api/src/modules/organization/infrastructure/in-memory/in-memory-company.store.ts` (modify), `apps/api/src/modules/organization/http/organization.router.ts` (modify)
   - Do: `CompanyQueries.list(page, visible: 'ALL' | readonly string[])`; Prisma adds `where: visible === 'ALL' ? {} : { id: { in: [...visible] } }` to both `findMany` and `count`; in-memory filters the same way. `ListCompanies.execute({ page, pageSize, actor })` computes `companiesWith(actor, 'organization.companies:read')`. Router: `bindRoute(router, routes.listCompanies, ({ query }, ctx) => deps.listCompanies.execute({ ...query, actor: requireActor(ctx) }))`. The other two organization routes stay as they are (bindRoute enforces them).
   - Observable result: typecheck passes.

8. **Infrastructure and migration**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/<timestamp>_create_role_assignments/migration.sql` (create), `apps/api/src/modules/identity/infrastructure/role-assignment.mapper.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-role-assignment.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/prisma-user.queries.ts` (modify), `apps/api/src/modules/identity/infrastructure/organization-company-directory.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-role-assignment.repository.ts` (create), `apps/api/src/modules/identity/infrastructure/in-memory/in-memory-user.queries.ts` (modify)
   - Do (skill `db-change`):
     - `enum IdentityRole { HOLDING_ADMIN HR DIRECT_MANAGER EMPLOYEE @@schema("identity") }`; `model RoleAssignment { id Uuid @id; userId @map("user_id") Uuid; user User @relation(...); role IdentityRole; companyId String? @map("company_id") @db.Uuid /// referencia por id a organization, sin FK (ADR 0010); assignedAt @map("assigned_at") Timestamptz(3); assignedBy String? @map("assigned_by") @db.Uuid; revokedAt DateTime? @map("revoked_at") Timestamptz(3); revokedBy String? @map("revoked_by") @db.Uuid; @@index([userId, revokedAt]) @@index([role, revokedAt]) @@map("role_assignments") @@schema("identity") }`; add `roleAssignments RoleAssignment[]` to `User`. `pnpm db:migrate --name create_role_assignments`, then `pnpm db:generate`. Replace `<timestamp>` in this plan's Files line with the real directory (record it in Deviations).
     - Mapper and Prisma repository like `session.mapper.ts` / `prisma-session.repository.ts` (`save` = upsert; `findActiveByUser` / `countActiveByRole` filter `revokedAt: null`).
     - `PrismaUserQueries.listUsers` (order by email, `search` → `email contains, mode insensitive`), `listActiveRoleAssignments` (null if the user row is missing; `assignedAt` as ISO).
     - `OrganizationCompanyDirectory` over `OrganizationApi.findCompany` (like `organization-employer-directory.ts:10-17`).
     - In-memory repository (Map) and in-memory `listUsers`/`listActiveRoleAssignments` (the in-memory user queries receive the in-memory role assignment store through the same structural-interface trick recorded in plan 001's Deviations).
   - Observable result: migration adds only the enum, table and indexes (no DROP); `pnpm test:integration` green.

9. **HTTP enforcement: 403 and access in bindRoute**
   - Files: `apps/api/src/http/request-context.ts` (modify), `apps/api/src/http/bind-route.ts` (modify), `apps/api/src/http/error-handler.ts` (modify)
   - Do:
     - `request-context.ts`: `class PermissionDeniedError extends Error` (adapter error, `code = 'FORBIDDEN'`, message `'No tienes permiso para esta acción'`).
     - `bind-route.ts`: after parsing and building the context, before calling the handler, `authorize(route.access, parsed.params, context)`: `public` → nothing; `authenticated` → `requireActor`; `permission` → `requireActor`, then if `companyParam` read that key from the parsed params (must be a string; a contract that names a missing param is a programming error → throw `Error`) and check `hasPermission(actor, permission, companyId)`, else `hasPermission(actor, permission)`; false → throw `PermissionDeniedError`. Comment: 403 even when the company does not exist, so a caller without scope cannot probe which companies exist.
     - `error-handler.ts`: handle `PermissionDeniedError` → 403 `{ code, message }`, next to `AuthenticationRequiredError` (line 50).
   - Observable result: typecheck passes; an unauthenticated `GET /api/v1/companies` → 401; `POST /api/v1/auth/login` still public.

10. **Router, module registration, seed**
    - Files: `apps/api/src/modules/identity/http/access.router.ts` (create), `apps/api/src/modules/identity/identity.module.ts` (modify), `apps/api/src/modules/identity/index.ts` (modify), `apps/api/prisma/seed.ts` (modify)
    - Do:
      - `access.router.ts` `createAccessRouter(deps: { listUsers; listRoleAssignments; assignRole; revokeRoleAssignment })` with `accessRoutes`: `assignRole` passes `companyId: body.companyId ?? null` and `assignedBy: requireActor(ctx).userId`; `revokeRoleAssignment` passes `revokedBy`; queries unwrap/return as in `employees.router.ts`.
      - `AppModule.router` is a single function (`apps/api/src/shared/app-module.ts:17`): make `identity.module.ts` `router` return one `Router` that mounts both `createIdentityRouter(cradle)` and `createAccessRouter(cradle)`. Register `roleAssignmentRepository` (Prisma), `companyDirectory` (`OrganizationCompanyDirectory`), `assignRole`, `revokeRoleAssignment`, `listUsers`, `listRoleAssignments`; extend `IdentityCradle`.
      - `index.ts`: also export `ROLE_ASSIGNED`, `ROLE_REVOKED`.
      - `seed.ts`: after creating/finding `admin@example.com` (on `USER_ALREADY_EXISTS`, find its id with `listUsers.execute({ page: 1, pageSize: 1, search: 'admin@example.com' })`), `assignRole` `HOLDING_ADMIN` with `companyId: null`, `assignedBy: null`. Also create `rrhh@example.com` with the same `SEED_USER_PASSWORD` and assign `HR` on the "APS Holding S.A. de C.V." company (`holding.id`, `seed.ts:30`). Ignore `USER_ALREADY_EXISTS` and `ROLE_ALREADY_ASSIGNED`; throw anything else. Both only when `SEED_USER_PASSWORD` is set.
    - Observable result: `tests/container.test.ts` green; `pnpm db:seed` twice leaves exactly one active assignment per seeded user.

11. **Throttle finding (decision 16)**
    - Files: `apps/api/src/modules/identity/application/commands/log-in.command.ts` (modify), `apps/api/src/modules/identity/domain/login-throttle.ts` (modify), `plans/hallazgos/identity-throttle-reserva-ip.md` (modify)
    - Do: in `reserveOrBlock` (`log-in.command.ts:140-162`) stop at the first blocked key: do not reserve the remaining keys, release only those already reserved. Fix the two comments the finding cites (I4): a block may also have been set by a concurrent reservation; releasing ours stays correct because `releaseAttempt` only lifts the block when failures drop below the limit. Finding frontmatter → `status: planned`, `plan: identity-acceso/002`. I5 stays documented as not reproduced (no change).
    - Observable result: typecheck passes.

12. **Existing tests adapted to protected routes**
    - Files: `apps/api/tests/test-app.ts` (modify), `apps/api/tests/http.test.ts` (modify)
    - Do: `test-app.ts` registers `roleAssignmentRepository` (in-memory) and a fake `companyDirectory` backed by the same `InMemoryCompanyStore`, and exports `signInAs(app/container, { role, companyId? }): Promise<string>` that registers a user through `registerUser`, assigns the role through `assignRole` (`assignedBy: null`) and logs in with `client: 'mobile'`, returning the Bearer token. `http.test.ts`: send `Authorization: Bearer <HOLDING_ADMIN token>` on the existing business-route calls — mechanical change, no new scenarios (the tester adds them).
    - Observable result: `pnpm --filter @rrhh/api test` green.

13. **Documentation**
    - Files: `docs/architecture.md` (modify), `docs/adr/0012-autorizacion-declarada-en-contratos.md` (create), `docs/adr/README.md` (modify), `plans/identity-acceso/README.md` (modify)
    - Do: ADR 0012 (Spanish, from `docs/adr/0000-plantilla.md`): access declared per route in contracts (deny by default), enforced in `bindRoute`, grants expanded once per request, fixed role catalog, row filtering in use cases, 403 without probing; alternatives: checks inside each handler; permissions in a JWT. Index row. `architecture.md`: request-flow section adds the authorization step and "Pendiente" drops RBAC except team/self scopes. README: plan 002 row title without "(TBD)".
    - Observable result: `pnpm check` passes.

14. **Test files of this plan** (declared for `pnpm plans:scope`; written by the tester)
    - Files: `packages/contracts/src/identity/access.contract.test.ts` (create), `apps/api/src/shared/application/actor.test.ts` (create), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (create), `apps/api/src/modules/identity/domain/role-assignment.test.ts` (create), `apps/api/src/modules/identity/application/commands/assign-role.command.test.ts` (create), `apps/api/src/modules/identity/application/commands/revoke-role-assignment.command.test.ts` (create), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `apps/api/src/modules/identity/application/commands/log-in.command.test.ts` (modify), `apps/api/src/modules/organization/application/queries/list-companies.query.test.ts` (create), `apps/api/tests/authorization.test.ts` (create), `apps/api/tests/integration/identity/prisma-role-assignment.int.test.ts` (create), `apps/api/tests/integration/identity/prisma-user.queries.int.test.ts` (create), `apps/api/tests/integration/organization/prisma-company.int.test.ts` (modify)
    - Do: nothing for the implementer.
    - Observable result: test suites green.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass; web and mobile typecheck.
- [ ] Migration `*_create_role_assignments` adds `identity.role_assignments` and enum `IdentityRole`, no DROP; `company_id` has no FK.
- [ ] Without a session, every business route (`GET/POST /companies`, `GET /companies/:id`, `GET/POST /companies/:id/employees`, `GET /users`, role-assignment routes) → 401 `AUTHENTICATION_REQUIRED`; `POST /auth/login` stays public; `/health/live` and `/iclock/*` unchanged.
- [ ] After `pnpm db:seed`, `admin@example.com` (HOLDING_ADMIN) can call every route; `GET /companies` returns all companies.
- [ ] `rrhh@example.com` (HR on APS Holding S.A. de C.V.): `GET /companies` returns only that company; `GET /companies/:id` and `GET/POST /companies/:id/employees` work for it and return 403 `FORBIDDEN` for another company (including a non-existent id); `POST /companies`, `GET /users` and role routes → 403.
- [ ] A user with no assignments gets 403 on every business route and 200 on `/auth/me`.
- [ ] `POST /users/:id/role-assignments`: HR with an active `companyId` → 201; HR without `companyId` or HOLDING_ADMIN with one → 422 `INVALID_ROLE_SCOPE`; `DIRECT_MANAGER`/`EMPLOYEE` → 422 `ROLE_NOT_ASSIGNABLE`; unknown company → 404 `COMPANY_NOT_FOUND`; inactive company → 422 `COMPANY_INACTIVE`; unknown user → 404 `USER_NOT_FOUND`; duplicate active → 409 `ROLE_ALREADY_ASSIGNED`.
- [ ] `DELETE .../role-assignments/:id` → 204 and the next request of that user reflects the loss (403); the only active HOLDING_ADMIN cannot be revoked → 422 `LAST_HOLDING_ADMIN`; a revoked or foreign id → 404 `ROLE_ASSIGNMENT_NOT_FOUND`; the row keeps `revoked_at`/`revoked_by`.
- [ ] `GET /openapi.json` (non-production): `/auth/login` has `security: []`; business operations carry `x-permission`; the Error response mentions 403.
- [ ] Login throttle: a login whose email key is blocked does not reserve the IP key (finding L3) — checked in tests; the finding is `planned`.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                 |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | role catalog (scopes, inert roles, `grantsFor`), `RoleAssignment.assign` scope rules and revoke idempotence                                                           |
| application | yes     | `hasPermission`/`companiesWith`; `AssignRole` and `RevokeRoleAssignment` every error; `SessionAuthenticator` grants; `ListCompanies` filtering; `LogIn` L3 regression |
| contract    | yes     | every route declares `access`; access routes shapes; OpenAPI security/x-permission snapshot                                                                           |
| http        | yes     | 401/403/200 matrix per role for every business route, company param probing, assignment/revocation effects on the next request, last admin                            |
| integration | yes     | Prisma role assignment repository (active filters, count), user queries (search, assignments), companies list filtered by ids                                         |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                           |

## Deviations

Todas cosméticas (fix forward); ninguna cambia diseño ni alcance.

1. **Nombre de la migración (paso 8)**: el directorio real es
   `apps/api/prisma/migrations/20260930150447_create_role_assignments/` (SQL revisado: solo enum,
   tabla, dos índices y la FK a `users`; sin DROP; `company_id` sin FK).
2. **`Grant` vive en `@rrhh/domain`, no en `shared/application/actor.ts` (pasos 1, 4, 5)**:
   `arch:check` (`domain-is-pure`) prohíbe que `identity/domain/role-catalog.ts` importe de
   `src/shared/application/`. Se declaró `Grant` en `packages/domain/src/identity/access.ts` y
   `actor.ts` lo importa y lo re-exporta (`export type { Grant }`).
3. **`openapi.test.ts` (paso 3)**: además de la aserción del `security` global, los fixtures de
   `defineRoute` de ese archivo necesitaron el campo `access` (ahora obligatorio) para compilar, y
   el conteo de operaciones pasó de 8 a 12 (`toHaveLength(12)`) por las 4 rutas nuevas.
4. **`seed.ts` (paso 10)**: `ListCompanies` ahora exige un actor; el seed usa un `Actor` de
   sistema con `organization.companies:read` de todo el holding para localizar la empresa.
5. **Tests existentes tocados fuera de la lista de archivos del plan (paso 12)**, solo para que
   compilen/pasen con las rutas protegidas y los puertos nuevos (mecánico, sin escenarios nuevos):
   `apps/api/src/modules/identity/application/queries/get-current-user.query.test.ts` (el stub de
   `UserQueries` cumple los dos métodos nuevos) y `apps/api/tests/zkteco-adms.test.ts` (su último
   test crea una empresa y ahora inicia sesión como HOLDING_ADMIN). En archivos que sí están en la
   lista (paso 14, del tester) se hicieron solo ajustes mecánicos: `session-authenticator.test.ts`
   (nueva dependencia y `grants: []` esperado) y `prisma-company.int.test.ts` (segundo argumento
   `'ALL'`).
6. **`plans/identity-acceso/README.md` (paso 13)**: la fila del plan 002 ya no lleva "(TBD)"; no
   hubo nada que cambiar.
7. `plans:scope` marca `plans/platform-openapi/001-documento-y-referencia-scalar.md` como fuera de
   alcance: ya estaba modificado antes de empezar (estado inicial del árbol), no lo toqué.

Verificación de la fase: `pnpm check` verde; `pnpm test:integration` verde (6 archivos, 39 tests);
`pnpm db:seed` dos veces (la segunda no crea nada: `ROLE_ALREADY_ASSIGNED` ignorado). No se
ejercitaron los criterios HTTP de aceptación contra la app corriendo (fase de verify).

## Test coverage

## Review findings

## Verification
