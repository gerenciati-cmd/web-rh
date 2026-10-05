---
status: done
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
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261002210000_add_employee_site/migration.sql` (create), `apps/api/src/modules/employees/infrastructure/employee.mapper.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts` (modify), `apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts` (modify)
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
   - Files: `apps/api/prisma/seed.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.test.ts` (modify), `packages/contracts/src/employees/employee.contract.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `apps/api/tests/authorization.test.ts` (modify), `apps/api/tests/invitations.test.ts` (modify), `apps/api/tests/password-resets.test.ts` (modify), `apps/api/tests/employee-rfc.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (modify), `apps/api/src/modules/employees/application/employees.facade.test.ts` (modify), `apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.test.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-site.command.test.ts` (create), `apps/api/tests/employee-site.test.ts` (create)
   - Do: every hire gets a `siteId`: HTTP tests create one with `createTestSite`; unit tests use a
     stub `SiteDirectory` and a fixed id; integration tests pass a fixed uuid (no FK). Seed: create
     the sede `'Cancún Centro'` (`MX`, `America/Cancun`) through `createSite` (ignore
     `SITE_ALREADY_EXISTS`, find it with `listSites`) and give both seed colaboradores its id. No
     assertion changes; no new test cases (the tester adds them).
   - Observable result: `pnpm check` and `pnpm test:integration` pass; `pnpm db:seed` twice OK.

## Acceptance criteria

- [x] `POST …/employees` without `siteId` → 400 at `siteId`; with an unknown site → 404
      `SITE_NOT_FOUND`; with a valid active site → 201 and the list shows `siteId`.
- [x] `PUT …/employees/:id/site` as HR of that company → 204 and the list shows the new site;
      unknown site → 404 `SITE_NOT_FOUND`; a DO site for an MX company → 422
      `SITE_COUNTRY_MISMATCH` (also on hire); employee of another company → 404/403 as for `PUT …/rfc`;
      anonymous → 401.
- [x] A colaborador created before this plan (`site_id` NULL) lists with `siteId: null` and can get
      a site through the `PUT`.
- [x] Changing the site publishes `employees.employee.site-assigned`; changing the RFC publishes
      `employees.employee.rfc-assigned` (checked in tests; no consumer yet).
- [x] `pnpm db:seed` creates "Cancún Centro" and assigns it; idempotent.

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

1. **Migration folder** (cosmetic): written by hand as `20261002210000_add_employee_site/migration.sql`
   (`ADD COLUMN site_id UUID` + index, no `DROP`), applied to the dev DB with `db:deploy`; the
   `YYYYMMDDHHMMSS` placeholder is replaced.
2. **Two test files outside the Step 7 list, forced by typecheck** (cosmetic):
   `apps/api/src/modules/employees/application/employees.facade.test.ts` (new `siteId` in
   `EmployeeProps`, new `listActiveOnSite` in `EmployeeQueries`) and
   `apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.test.ts`
   (new `listActiveOnSite` in `EmployeesApi`). Fixture-only edits.
3. **One assertion changed** (contradicted by the plan's own new behavior):
   `employee.test.ts` "assignRfc no emite eventos" now asserts `EMPLOYEE_RFC_ASSIGNED` is recorded
   on change (Step 2 makes `assignRfc` record it). The tester adds the no-change/no-event cases.
4. **Seed on existing data** (note): colaboradores already seeded keep `site_id` NULL (the seed
   skips them as `EMPLOYEE_ALREADY_EXISTS`); only a fresh seed assigns "Cancún Centro". They can
   get a site through `PUT …/site`. `pnpm db:seed` twice is idempotent (verified).

Verification run: `pnpm check` green; `pnpm test:integration` 160/160; `pnpm db:seed` x2 OK.

## Test coverage

Baseline: `pnpm check` green (exit 0) before writing tests. No GAP and no NOT CONFIRMED: every
plan promise is implemented and was confirmed by execution.

| Behavior (plan / code)                                                                                                        | Source                                             | Layer       | Test                                                                                            | State     |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | --------- |
| `hire` stores `siteId`                                                                                                        | `employee.ts` (`hire`)                             | domain      | `employee.test.ts › sede › guarda la sede…`                                                     | CONFIRMED |
| `assignSite` changes site, records `EMPLOYEE_SITE_ASSIGNED` with previous id                                                  | `employee.ts` (`assignSite`)                       | domain      | `employee.test.ts › sede › assignSite cambia la sede…`, `…registra previousSiteId null`         | CONFIRMED |
| `assignSite` same site is a no-op, no event                                                                                   | `employee.ts` (`assignSite`)                       | domain      | `employee.test.ts › sede › …misma sede no cambia nada…`                                         | CONFIRMED |
| `assignRfc` event only when the RFC changes                                                                                   | `employee.ts` (`assignRfc`)                        | domain      | `employee.test.ts › RFC › …registra EMPLOYEE_RFC_ASSIGNED…`, `…no registra evento si no cambia` | CONFIRMED |
| `RegisterEmployee` saves site; `SITE_NOT_FOUND` / `SITE_INACTIVE` / `SITE_COUNTRY_MISMATCH` (nothing saved or published)      | `register-employee.command.ts` (`checkSite`)       | application | `register-employee.command.test.ts › sede`                                                      | CONFIRMED |
| `AssignEmployeeSite`: change + event, null→site, idempotent, other company, missing employer, three site errors, save failure | `assign-employee-site.command.ts`                  | application | `assign-employee-site.command.test.ts` (10 tests)                                               | CONFIRMED |
| `AssignEmployeeRfc` publishes `EMPLOYEE_RFC_ASSIGNED` on change only                                                          | `assign-employee-rfc.command.ts`                   | application | `assign-employee-rfc.command.test.ts › publica… / no publica…`                                  | CONFIRMED |
| Facade `siteId` in `findEmployee`; `listActiveOnSite` delegates                                                               | `employees.facade.ts`                              | application | `employees.facade.test.ts`                                                                      | CONFIRMED |
| `siteId` required uuid in register; `AssignEmployeeSiteSchema`; route access; list item `siteId` nullable                     | `employee.contract.ts:16,35,72,115`                | contract    | `employee.contract.test.ts` (sede, AssignEmployeeSiteSchema, assignEmployeeSite, ListItem)      | CONFIRMED |
| Hire: 400 w/o `siteId`, 404 `SITE_NOT_FOUND`, 422 `SITE_INACTIVE`, 422 `SITE_COUNTRY_MISMATCH`, 201 lists `siteId`            | router + commands                                  | http        | `tests/employee-site.test.ts › POST…`                                                           | CONFIRMED |
| PUT site: 204 (HR), idempotent, legacy NULL row, 400, 404, 422 x2, other company 404/403, 401, OpenAPI                        | router + `assign-employee-site.command.ts`         | http        | `tests/employee-site.test.ts › PUT…`, `› OpenAPI`                                               | CONFIRMED |
| `site_id` persisted/updated; NULL rows; `listDirectory.siteId`                                                                | `employee.mapper.ts`, `prisma-employee.queries.ts` | integration | `prisma-employee.int.test.ts › Sede en PrismaEmployeeRepository…` (4 tests)                     | CONFIRMED |
| `listActiveOnSite`: ACTIVE only, one site, all companies, order, null RFC, empty                                              | `prisma-employee.queries.ts:122`                   | integration | same describe (4 tests)                                                                         | CONFIRMED |
| Events checked at HTTP level                                                                                                  | n/a                                                | http        | not written: the HTTP container has no event recorder; covered at application layer             | n/a       |
| `pnpm db:seed` creates "Cancún Centro", idempotent                                                                            | `seed.ts`                                          | —           | not a test layer; run by the implementer (Deviation 4) and left to the verifier                 | n/a       |

New tests: domain 5, application 20, contract 13, http 17, integration 8.

Closing run: `pnpm check` green; `pnpm test:integration` 168/168 (160 before).

## Review findings

Review 2026-10-02 (reviewer subagent), diff `a06fbf5..HEAD`.

**Checklist: 13/13 passed.**

- [x] `pnpm plans:scope … --base a06fbf5`: 38 changed / 38 declared. Hot files
      `schema.prisma` and `test-app.ts` are also declared in the plan; their edits are the planned
      ones (one column + index; `siteId` in the hand-written queries, `listActiveOnSite`,
      `createTestSite`). `in-memory-employee.repository.ts` was declared but is unchanged, which
      the plan allows ("nothing beyond what typecheck requires"). Against the default base
      (`main`) the script also lists files from the earlier plans on this branch. That is
      expected and not a finding.
- [x] `pnpm check` exit 0 (format, typecheck/lint/test 19/19 turbo tasks, arch, plans, harness,
      hooks, bootstrap, quality).
- [x] `pnpm test:integration` 168/168.
- [x] Business rules: `assignSite`/`assignRfc` event rules are in `domain/`. The site checks
      (exists / active / same country) are in the commands, as the plan says. This matches
      the existing employer-active check (cross-module data comes in through a port). See L1.
- [x] CQRS-lite: both commands go aggregate → `EmployeeRepository` → `Result`. `listActiveOnSite`
      is on `EmployeeQueries`, not on the repository.
- [x] Types come from `@rrhh/contracts` (`siteId` in list/register, `AssignEmployeeSiteSchema`,
      route bound with `bindRoute`). OpenAPI snapshot regenerated, count 26.
- [x] Errors: `SITE_NOT_FOUND` (NotFound), `SITE_INACTIVE` and `SITE_COUNTRY_MISMATCH`
      (BusinessRuleViolation), all with stable codes and Spanish messages.
- [x] Time comes from `clock.now()` in both commands. No money. No ids generated.
- [x] New migration `20261002210000_add_employee_site` (later than `create_sites`):
      `ADD COLUMN site_id UUID` + index `(site_id, status)`. No DROP, no FK.
- [x] DI: `siteDirectory` and `assignEmployeeSite` registered once. `container.test.ts` green.
- [x] No secrets or real personal data. The seed uses the existing fictional data plus the
      sede "Cancún Centro".
- [x] Deviations are accurate. Spot-checked: Deviation 3 (the `employee.test.ts` assertion now
      expects `EMPLOYEE_RFC_ASSIGNED`, and a no-change/no-event test was added). Deviation 1
      (the migration folder has a real timestamp).
- [x] Docs: `docs/architecture.md`, ADR 0005 and `docs/conventions.md` only cite
      `employees.employee.hired` as an example. They are not stale, and the new event names
      follow `<modulo>.<agregado>.<pasado>`.

**Bug hunt.** I traced each flow: contract → router → command → port/adapter
(`OrganizationApi.findSite`) → aggregate → mapper/Prisma → list DTO → OpenAPI. Tenancy: a
different `companyId` returns `EMPLOYEE_NOT_FOUND`, and the route requires `employees:update`
scoped to `companyId`. Events are published only after a successful save (same pattern as
`RegisterEmployee`).

Critical: 0 · High: 0 · Medium: 0 · Low: 3 (none blocks verify).

- **L1 — the site check is duplicated** (maintainability):
  `apps/api/src/modules/employees/application/commands/register-employee.command.ts:99-107` and
  `apps/api/src/modules/employees/application/commands/assign-employee-site.command.ts:61-69`
  contain the same `checkSite`. Scenario: a later rule change (e.g. allowing an inactive site
  for a transfer) gets applied to one command and not the other, so hire and change start
  validating differently. The plan asked for this shape, so this is not a defect. Consider a
  shared helper if a third caller appears.
- **L2 — repeating the same site fails once that site is inactive** (uncertain whether this is
  intended): `assign-employee-site.command.ts:48-51` validates the site before
  `assignSite` gets a chance to treat it as a no-op. Scenario: a colaborador's sede is later
  deactivated, HR re-saves the form with the same `siteId`, and gets 422 `SITE_INACTIVE` instead
  of the documented "idempotent" 204. This is harmless, and arguably correct because it
  surfaces the stale site.
- **L3 — sites can be assigned to TERMINATED colaboradores** (uncertain: no lifecycle rule
  forbids it): `apps/api/src/modules/employees/domain/employee.ts:135-142` does not check
  status. Scenario: `PUT …/site` on a terminated colaborador returns 204 and publishes
  `employees.employee.site-assigned`. If the future attendance sync (`attendance-marcaciones/005`)
  pushes users on that event without checking `active` via `findEmployee`, a terminated person
  could be loaded onto a checador. `assignRfc` behaves the same way and did before this plan.
  The future consumer should check `EmployeeSummary.active`. Noting it here for that plan's
  author. No hallazgo filed, because no consumer exists yet.

Also noted, not a finding: `apps/api/prisma/seed.ts:69` looks up the existing sede with
`listSites` `pageSize: 100`. With more than 100 sedes, re-running the seed would throw "No se
encontró la sede ya existente". This is a dev-only script and acceptable for now.

All checklist items passed. Status → `verify`.

## Verification

**PASS** — 2026-10-02, main session, at `b586557`, against the dev API on `localhost:3000`
(migration `20261002210000_add_employee_site` applied to the dev DB).

- Suites: `pnpm check` and `pnpm test:integration` (168) green at the review; `plans:scope
--base a06fbf5` all in scope.
- Script over HTTP (synthetic data: a new MX company, two MX sedes and one DO sede with a
  random suffix), 17/17 PASS:
  - Hire without `siteId` → 400 at `siteId`; unknown site → 404 `SITE_NOT_FOUND`; DO site for the
    MX company → 422 `SITE_COUNTRY_MISMATCH`; active MX site → 201, the list shows `siteId`.
  - `PUT …/site` to the other MX site → 204 and the list shows it; same site again → 204; unknown
    → 404 `SITE_NOT_FOUND`; DO site → 422 `SITE_COUNTRY_MISMATCH`; HR of another company → 403;
    anonymous → 401.
  - A seed colaborador of the holding listed with `siteId: null`; `PUT` through the wrong company
    → 404 `EMPLOYEE_NOT_FOUND`; as HR of the holding → 204 and it lists the site.
  - `/api/v1/openapi.json` has the `PUT …/site` route.
- Events (criterion 4): verified by the application tests with `RecordingEventBus`
  (`assign-employee-site.command.test.ts`, `assign-employee-rfc.command.test.ts`); no consumer
  exists yet, so there is nothing to observe in the running app.
- Seed: `pnpm db:seed` run twice more on the dev DB → "seed completado" both times; `GET /sites`
  lists exactly one "Cancún Centro" (MX, `America/Cancun`, active). On this pre-existing DB the
  two seed colaboradores keep `site_id` NULL (Deviation 4); a fresh DB assigns them the sede.
- Data left in the dev DB: the company `Verificación Sede <suffix> S.A. de C.V.` with one
  colaborador, three `Verificación sede …` sedes, and one seed colaborador of the holding now
  assigned to `Verificación sede A …` (reassignable with `PUT …/site`).
