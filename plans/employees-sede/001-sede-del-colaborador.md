---
status: approved
module: employees
min_implementer: mid
depends_on: [organization-sedes/001]
---

# 001 — Sede of the colaborador

## Context

**What exists today** (after `employees-rfc/001`, done):

- `EmployeeProps` has `companyId`, `nationalId`, `rfc`, names, email, position, hire date,
  status; no site (`apps/api/src/modules/employees/domain/employee.ts:21-32`). Events
  `EMPLOYEE_HIRED` / `EMPLOYEE_TERMINATED` (`employee.ts:34-35`); `Employee.hire` (`:49-…`) and
  `assignRfc` (`:120-…`) — `assignRfc` records no event.
- `RegisterEmployee.execute` validates employer → ids → duplicates → hires → saves → publishes
  (`application/commands/register-employee.command.ts:50-80`); deps at `:39-45`. Its complexity is
  at the lint limit (12) after `employees-rfc/001` review L2, so new checks go in helpers.
- `AssignEmployeeRfc` has no `eventBus` and publishes nothing
  (`application/commands/assign-employee-rfc.command.ts:15-47`).
- Cross-module port pattern: `EmployerDirectory` (`application/ports/employer-directory.ts:10-18`)
  with adapter `OrganizationEmployerDirectory` over `OrganizationApi`
  (`infrastructure/organization-employer-directory.ts:19-35`), registered in
  `employees.module.ts:32`.
- Contract: `EmployeeListItemSchema` (`packages/contracts/src/employees/employee.contract.ts:10-22`),
  `RegisterEmployeeSchema` (`:25-58`), `assignEmployeeRfc` route (`:98-107`) — the shape to copy.
- Public API `EmployeesApi` (`application/employees.facade.ts:7-57`): `EmployeeSummary` without
  site; `findByRfcs`, `rfcsInCompanies`.
- Callers hiring colaboradores today (all break once a site is required), from
  `grep -rlE "country: 'MX', number|Employee\.hire\(|registerEmployee\.execute"`: listed in Step 7.

**What `organization-sedes/001` promises:** `OrganizationApi.findSite(siteId):
Promise<SiteSummary | null>` with `SiteSummary { id; name; country; timeZone; active }`
(exported from `@/modules/organization`), routes `POST /sites`, `GET /sites`, in-memory
`InMemorySiteStore` wired in `apps/api/tests/test-app.ts`.

**What we need** (README decisions 1–3): `siteId` on the colaborador, required at hire,
changeable, and in the same country as the colaborador's company; events when the site or the RFC changes; the active members of a site for the
attendance sync.

**Approach.** Copy the RFC pattern: a nullable column (existing rows have no site), required by
the contract and the command for new hires, a `PUT …/site` endpoint, and an `employees` port
`SiteDirectory` (adapter over `OrganizationApi.findSite`). Events carry only ids; consumers read
details through `EmployeesApi`. Alternative considered: storing the site name on the colaborador
for display — rejected, the name belongs to `organization`.

## Out of scope

- Any attendance change (sync is `attendance-marcaciones/005`, not written yet).
- Termination endpoint. Site name in the employees list (only `siteId`). Web/mobile screens.

## Dependencies

- `organization-sedes/001` — `OrganizationApi.findSite`, `SiteSummary`, sites routes and the
  in-memory site store in `test-app.ts` (see Context).

## Steps

1. **Contract**
   - Files: `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do: `EmployeeListItemSchema` gets `siteId: z.uuid().nullable()` after `rfc`.
     `RegisterEmployeeSchema` gets `siteId: z.uuid()` (required). New
     `AssignEmployeeSiteSchema = z.object({ siteId: z.uuid() }).meta({ id: 'AssignEmployeeSiteInput' })`
     and route `assignEmployeeSite`: `PUT /companies/:companyId/employees/:employeeId/site`,
     summary `'Asigna o cambia la sede de un colaborador'`,
     `requires('employees:update', { companyParam: 'companyId' })`, params as
     `assignEmployeeRfc`, `response: z.undefined()`, `successStatus: 204`. Regenerate the
     snapshot; operation count +1 in `openapi.test.ts`.
   - Observable result: contracts typecheck passes.

2. **Domain**
   - Files: `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/src/modules/employees/domain/errors.ts` (modify)
   - Do: `EmployeeProps.siteId: string | null` (docblock: required at hire; null in rows older than
     the field). `hire` input `siteId: string` (required) stored as is. New events
     `EMPLOYEE_SITE_ASSIGNED = 'employees.employee.site-assigned'` (payload
     `{ employeeId, siteId, previousSiteId }`) and
     `EMPLOYEE_RFC_ASSIGNED = 'employees.employee.rfc-assigned'` (payload `{ employeeId }`).
     `assignSite(siteId: string, now: Date): void` — no-op when equal; else sets it and records
     `EMPLOYEE_SITE_ASSIGNED`. `assignRfc` gets a `now: Date` parameter and records
     `EMPLOYEE_RFC_ASSIGNED` when the RFC actually changes (unchanged errors).
     Errors: `SiteNotFoundError extends NotFoundError` (`'SITE_NOT_FOUND'`, `'La sede no existe'`,
     `{ siteId }`), `InactiveSiteError extends BusinessRuleViolationError`
     (`override readonly code = 'SITE_INACTIVE'`, `'La sede está inactiva'`, `{ siteId }`),
     `SiteCountryMismatchError extends BusinessRuleViolationError`
     (`override readonly code = 'SITE_COUNTRY_MISMATCH'`,
     `'La sede no es del mismo país que la razón social'`, `{ siteId, siteCountry, companyCountry }`).
   - Observable result: typecheck lists only the call sites Steps 3–7 fix.

3. **Port and adapter to organization**
   - Files: `apps/api/src/modules/employees/application/ports/site-directory.ts` (create), `apps/api/src/modules/employees/infrastructure/organization-site-directory.ts` (create)
   - Do (shape of `employer-directory.ts:10-18` and `organization-employer-directory.ts:19-35`):
     `interface WorkSite { id: string; country: CountryCode; active: boolean }` (`CountryCode` from
     `@rrhh/domain`, as in `employer-directory.ts`);
     `interface SiteDirectory { find(siteId: string): Promise<WorkSite | null> }`;
     `OrganizationSiteDirectory` over `organizationApi.findSite`.
   - Observable result: `pnpm arch:check` passes.

4. **Application**
   - Files: `apps/api/src/modules/employees/application/commands/register-employee.command.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-site.command.ts` (create), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.ts` (modify), `apps/api/src/modules/employees/application/queries/employee.queries.ts` (modify), `apps/api/src/modules/employees/application/employees.facade.ts` (modify)
   - Do, `RegisterEmployee`: input `siteId: string`; new dep `siteDirectory`; after the employer
     check, a private helper `checkSite(siteId, employer.country)` returning `SiteNotFoundError` /
     `InactiveSiteError` / `SiteCountryMismatchError` (site country ≠ employer country, README
     decision 3) or `null` (keeps `execute` under the complexity limit); pass `siteId` to `hire`.
   - Do, `AssignEmployeeSite` (shape of `assign-employee-rfc.command.ts:15-47`): deps
     `employeeRepository, employerDirectory, siteDirectory, clock, eventBus`; employee of another
     company → `EmployeeNotFoundError`; employer looked up by the employee's `companyId` (missing →
     `EmployerNotFoundError`); same three site checks as `checkSite` against the employer country; `assignSite`; save; publish; `ok(undefined)`.
   - Do, `AssignEmployeeRfc`: deps add `clock, eventBus`; call `assignRfc(rfc, clock.now())`;
     publish `pullEvents()` after save.
   - Do, queries: `EmployeeQueries.listActiveOnSite(siteId): Promise<SiteMember[]>` with
     `interface SiteMember { id; companyId; fullName; rfc: string | null }` (only `ACTIVE`).
   - Do, facade: `EmployeeSummary.siteId: string | null` (filled in `findEmployee`);
     `EmployeesApi.listActiveOnSite(siteId)` delegating to the queries. Docblock: consumer is the
     attendance sync.
   - Observable result: typecheck passes.

5. **Persistence**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_employee_site/migration.sql` (create), `apps/api/src/modules/employees/infrastructure/employee.mapper.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts` (modify), `apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts` (modify)
   - Do: `Employee` gets `siteId String? @map("site_id") @db.Uuid` with
     `/// referencia por id a organization.sites, sin FK (ADR 0010)` and `@@index([siteId, status])`.
     Migration (as in `employees-rfc/001` Deviation 1 if `migrate dev` cannot run): `ADD COLUMN` +
     index, no `DROP`; replace the placeholder with the real folder; note in Deviations. Mapper
     reads/writes `siteId`. `listDirectory` returns `siteId`; `listActiveOnSite` =
     `findMany({ where: { siteId, status: 'ACTIVE' }, orderBy: [{ lastName }, { firstName }, { id }] })`.
     In-memory repository: nothing beyond what typecheck requires.
   - Observable result: migration applied; typecheck passes.

6. **HTTP, module, public API**
   - Files: `apps/api/src/modules/employees/http/employees.router.ts` (modify), `apps/api/src/modules/employees/employees.module.ts` (modify), `apps/api/src/modules/employees/index.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do: `bindRoute` for `assignEmployeeSite` (like `assignEmployeeRfc`). Register
     `siteDirectory: asClass(OrganizationSiteDirectory)` and `assignEmployeeSite` in cradle and
     registrations. Export `EMPLOYEE_SITE_ASSIGNED`, `EMPLOYEE_RFC_ASSIGNED` and type `SiteMember`
     from `index.ts`. `test-app.ts`: the hand-written `employeeQueries` returns `siteId` and
     implements `listActiveOnSite`; add an exported helper `createTestSite(container, name?)` that
     creates an active MX site (`America/Cancun`) through `container.cradle.createSite` and
     returns its id.
   - Observable result: `tests/container.test.ts` resolves the new keys.

7. **Existing callers: seed and tests**
   - Files: `apps/api/prisma/seed.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.test.ts` (modify), `packages/contracts/src/employees/employee.contract.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `apps/api/tests/authorization.test.ts` (modify), `apps/api/tests/invitations.test.ts` (modify), `apps/api/tests/password-resets.test.ts` (modify), `apps/api/tests/employee-rfc.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (modify)
   - Do: every hire gets a `siteId`: HTTP tests create one with `createTestSite`; unit tests use a
     stub `SiteDirectory` and a fixed id; integration tests pass a fixed uuid (no FK). Seed: create
     the sede `'Cancún Centro'` (`MX`, `America/Cancun`) through `createSite` (ignore
     `SITE_ALREADY_EXISTS`, find it with `listSites`) and give both seed colaboradores its id. No
     assertion changes; no new test cases (the tester adds them).
   - Observable result: `pnpm check` and `pnpm test:integration` pass; `pnpm db:seed` twice OK.

## Acceptance criteria

- [ ] `POST …/employees` without `siteId` → 400 at `siteId`; with an unknown site → 404
      `SITE_NOT_FOUND`; with a valid active site → 201 and the list shows `siteId`.
- [ ] `PUT …/employees/:id/site` as HR of that company → 204 and the list shows the new site;
      unknown site → 404 `SITE_NOT_FOUND`; a DO site for an MX company → 422
      `SITE_COUNTRY_MISMATCH` (also on hire); employee of another company → 404/403 as for `PUT …/rfc`;
      anonymous → 401.
- [ ] A colaborador created before this plan (`site_id` NULL) lists with `siteId: null` and can get
      a site through the `PUT`.
- [ ] Changing the site publishes `employees.employee.site-assigned`; changing the RFC publishes
      `employees.employee.rfc-assigned` (checked in tests; no consumer yet).
- [ ] `pnpm db:seed` creates "Cancún Centro" and assigns it; idempotent.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                   |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `hire` stores `siteId`; `assignSite` no-op/event; `assignRfc` event only on change                                                      |
| application | yes     | `RegisterEmployee` site errors (incl. country mismatch); `AssignEmployeeSite` all paths; RFC event published; facade `listActiveOnSite` |
| contract    | yes     | `siteId` required in register; `AssignEmployeeSiteSchema`; route access                                                                 |
| http        | yes     | acceptance criteria over supertest                                                                                                      |
| integration | yes     | `site_id` persisted, `listActiveOnSite` (active only, order), NULL rows                                                                 |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                             |

## Deviations

## Test coverage

## Review findings

## Verification
