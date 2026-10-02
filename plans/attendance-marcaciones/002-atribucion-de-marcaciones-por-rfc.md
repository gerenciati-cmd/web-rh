---
status: review
module: attendance
min_implementer: mid
depends_on: [employees-rfc/001]
---

# 002 — Attribution of marcaciones by RFC

## Context

**What exists today** (plan 001, `done`):

- Punches are stored with the raw device `pin` (`apps/api/prisma/schema.prisma`, model
  `AttendancePunch`: `pin String @db.VarChar(32)`, unique `[deviceId, pin, deviceLocalTime]`).
- `PunchSchema` has no colaborador (`packages/contracts/src/attendance/punch.contract.ts:7-22`);
  filters `deviceId`, `pin`, `from`, `to` (`punch.contract.ts:25-31`); route
  `GET /attendance/punches` with `requires('attendance.punches:read')` and no `companyParam`
  (`punch.contract.ts:34-43`).
- Read port `AttendanceQueries.listPunches(filters): Promise<Page<PunchDto>>`
  (`apps/api/src/modules/attendance/application/queries/attendance.queries.ts:7-11`); Prisma
  adapter builds `where` from the filters and orders `occurredAt desc, id desc`
  (`apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts:46-83`); the
  in-memory adapter mirrors it (`infrastructure/in-memory/in-memory-attendance.store.ts`).
- `ListPunches` returns an empty page to any actor without a holding-wide grant
  (`application/queries/list-punches.query.ts:21-37`), and HR does not have
  `attendance.punches:read` (`apps/api/src/modules/identity/domain/role-catalog.ts:16-29`,
  comment at `:22-23`). `companiesWith` gives `'ALL'` or the actor's company ids
  (`apps/api/src/shared/application/actor.ts:32-40`).
- Module wiring: `apps/api/src/modules/attendance/attendance.module.ts:19-46`.
- Cross-module pattern to imitate: identity's port + adapter over `EmployeesApi`
  (`apps/api/src/modules/identity/application/ports/employee-directory.ts:1-16`,
  `apps/api/src/modules/identity/infrastructure/employees-employee-directory.ts:1-23`,
  registered at `apps/api/src/modules/identity/identity.module.ts:115`).

**What `employees-rfc/001` promises** (dependency, see below): `EmployeesApi.findByRfcs` and
`EmployeesApi.rfcsInCompanies`, RFC normalized uppercase and unique in the holding.

**What we need** (attendance README decisions 2, 5, 7, 8): each punch whose PIN is the RFC of a
colaborador is that colaborador's, and so belongs to that colaborador's company; HR reads the
punches of its companies' colaboradores; punches with no matching RFC stay visible only to
HOLDING_ADMIN.

**Approach.** Attribution is resolved **at read time**, not stored: the use case asks the
employees module (through a port) which RFCs belong to the actor's companies and filters
`pin IN (…)`, then enriches the page with the owners of its PINs. Alternative considered:
stamping `employeeId`/`companyId` on each punch at ingestion. Rejected: an RFC captured or
corrected after the marcación (README `employees-rfc` decision 3) would need a backfill job and
an event subscription, and attribution would drift from the colaborador record. Read-time lookup
is always current; at the holding's scale (hundreds to a few thousand colaboradores) the `IN`
list is acceptable. PIN matching is exact against the uppercase RFC: the devices send the RFC in
uppercase (decision 7), and PINs like `"1"` simply never match.

## Out of scope

- Storing the attribution, backfills, events.
- A `employeeId` filter on the punches endpoint (the `pin` filter with the RFC covers it).
- DO/CO devices and their PIN convention (`employees-rfc` README decision 5).
- Pushing users/PINs to the devices; reading the device's `USER` records (stay log-only).
- Shifts, jornadas, overtime, LFT rules. Web or mobile screens.

## Dependencies

- `employees-rfc/001` — `EmployeesApi` (from `@/modules/employees`) gains:
  - `findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]>` with
    `EmployeeRfcOwner { id: string; companyId: string; fullName: string; rfc: string; active: boolean }`
    (exported type), `[]` for empty input, colaboradores without RFC ignored.
  - `rfcsInCompanies(companyIds: readonly string[]): Promise<string[]>`, `[]` for empty input.
  - RFC values are normalized uppercase and unique across the holding.

## Steps

1. **Contract: owner on the punch**
   - Files: `packages/contracts/src/attendance/punch.contract.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do: add to `PunchSchema`, after `pin`:
     `employee: z.object({ id: z.uuid(), fullName: z.string(), companyId: z.uuid() }).nullable()`
     `.describe('Colaborador cuyo RFC coincide con el PIN; null si ninguno')`. Regenerate with
     `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: `pnpm --filter @rrhh/contracts typecheck` passes.

2. **Port and adapter to the employees module**
   - Files: `apps/api/src/modules/attendance/application/ports/punch-owner-directory.ts` (create), `apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.ts` (create)
   - Do, port (shape of identity's `employee-directory.ts:1-16`, docblock in Spanish: the PIN of
     the device is the colaborador's RFC, decision 7):
     `interface PunchOwner { employeeId: string; companyId: string; fullName: string }`;
     `interface PunchOwnerDirectory { ownersOf(pins: readonly string[]): Promise<ReadonlyMap<string, PunchOwner>>;
pinsOfCompanies(companyIds: readonly string[]): Promise<string[]> }`.
   - Do, adapter `EmployeesPunchOwnerDirectory` (shape of `employees-employee-directory.ts:1-23`),
     deps `{ employeesApi: EmployeesApi }`: `ownersOf` → `findByRfcs(unique pins)`, map keyed by
     `rfc`; `pinsOfCompanies` → `rfcsInCompanies(companyIds)`.
   - Observable result: `pnpm arch:check` passes (attendance imports employees only through
     `@/modules/employees`, only from `infrastructure/`).

3. **Read side: PIN filter and enrichment**
   - Files: `apps/api/src/modules/attendance/application/queries/attendance.queries.ts` (modify), `apps/api/src/modules/attendance/application/queries/list-punches.query.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify)
   - Do, `attendance.queries.ts`: `export type RawPunch = Omit<PunchDto, 'employee'>`;
     `listPunches(filters: ListPunchesQuery & { pins?: readonly string[] | undefined }):
Promise<Page<RawPunch>>` (docblock: `pins` restricts to those PINs; an empty array means no rows).
   - Do, both adapters: when `pins` is given add `pin: { in: [...pins] }` (in-memory: membership);
     return `RawPunch` items (no other change in order or filters). An explicit `pin` filter and
     `pins` combine with AND.
   - Do, `ListPunches`: deps `{ attendanceQueries, punchOwnerDirectory }`.
     `scope = companiesWith(actor, 'attendance.punches:read')`. If `'ALL'`: `page =
listPunches(filters)`. Else: `pins = await pinsOfCompanies(scope)`; if empty return the empty
     page as today; else `page = listPunches({ ...filters, pins })`. Then
     `owners = await ownersOf(page.items.map((p) => p.pin))` and map each item to
     `{ ...item, employee: owner ? { id: owner.employeeId, fullName: owner.fullName, companyId:
owner.companyId } : null }`. Replace the plan-001 comment with one citing README decision 8.
   - Observable result: typecheck passes.

4. **Permissions, wiring, existing tests**
   - Files: `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/src/modules/attendance/application/queries/list-punches.query.test.ts` (modify), `apps/api/tests/attendance.test.ts` (modify)
   - Do: add `'attendance.punches:read'` to HR after `'attendance.devices:read'` and replace the
     comment at `role-catalog.ts:22-23` with one citing decision 8 (HR sees its companies'
     colaboradores' punches). Tests: expected HR list/counts +1 only. Register
     `punchOwnerDirectory: asClass(EmployeesPunchOwnerDirectory).singleton()` in the cradle and
     registrations. In the two attendance test files, only adapt what stops compiling or asserts
     the plan-001 behavior that this plan changes on purpose (HR gets 403 / empty page; items
     without `employee`): pass a `punchOwnerDirectory` double or the real one, and turn the
     "HR → 403 on punches" assertion into "HR → 200". Add no new cases (the tester does).
   - Observable result: `pnpm check` passes.

5. **Docs and README**
   - Files: `docs/integraciones/zkteco-senseface-2a.md` (modify), `docs/harness/modules.json` (modify)
   - Do: runbook: a short section "Atribución" — enrol users on the device with their RFC (13
     chars, uppercase) as the user ID/PIN; the API attributes punches whose PIN matches a
     colaborador's RFC; capture missing RFCs with `PUT …/employees/:id/rfc`. `modules.json`
     attendance summary: append "Punches attributed by RFC." to the "Today:" sentence.
   - Observable result: `pnpm check` passes.

6. **Test files and deviation files of this plan** (declared for `pnpm plans:scope`; added by the
   main session after the testing phase)
   - Files: `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.test.ts` (create), `apps/api/tests/attendance-attribution.test.ts` (create), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (create), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (modify), `packages/contracts/src/attendance/punch.contract.test.ts` (modify)
   - Do: nothing for the implementer (the mapper is Deviation 1; the rest are the tester's).
   - Observable result: `pnpm plans:scope` lists no file of this plan as out of scope.

## Acceptance criteria

- [ ] With a MX colaborador whose RFC is `R` in company A, a registered device pushing ATTLOG
      with PIN `R` and PIN `1`: `GET /api/v1/attendance/punches` as HOLDING_ADMIN lists both; the
      `R` punch has `employee: { id, fullName, companyId: A }`, the `1` punch has `employee: null`.
- [ ] As HR of company A: 200 with only the `R` punch (filters `deviceId`, `from`, `to`, `pin`
      still apply). As HR of company B (no colaborador with that RFC): 200 with an empty page.
- [ ] A punch received **before** its colaborador had an RFC becomes attributed as soon as the RFC
      is set with `PUT …/employees/:id/rfc` (no reprocessing).
- [ ] A terminated colaborador's punches stay attributed to them.
- [ ] Anonymous → 401; an actor without the permission → 403.
- [ ] Real device: a person enrolled with their RFC as PIN marks, and their punch shows their
      `employee` (user with the SenseFace 2A; NOT VERIFIED if unavailable).

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                        |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | no      | (no domain rules change)                                                                                                                                     |
| application | yes     | `ListPunches`: holding vs company scope, empty company pins, enrichment with/without owner, filters pass through                                             |
| contract    | yes     | `PunchSchema.employee` nullable shape; HR now holds the route's permission                                                                                   |
| http        | yes     | acceptance criteria 1–5 over supertest with the in-memory employees store                                                                                    |
| integration | yes     | `PrismaAttendanceQueries.listPunches` with `pins` (IN, empty array, combined with `pin`); `EmployeesPunchOwnerDirectory` against the real employees adapters |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                  |

## Deviations

- Step 3 (cosmetic, fixed forward): `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` is not in the plan's file list, but `PunchMapper.toDto` returned `PunchDto` and no longer typechecks once `PunchDto` requires `employee`. Its return type changed to `RawPunch` (no behavior change).
- Step 3 (detail): in the Prisma adapter, `pin` and `pins` share the `pin` column, so they are combined as `pin: { equals, in }` (AND) instead of two spread keys, which would have overridden each other.
- Step 4 (detail): `role-catalog.test.ts` also asserts HR grant counts (7 to 8, 14 to 16); adapted along with the permission list. `list-punches.query.test.ts` got an inline `punchOwnerDirectory` double (no owners, no company pins).

## Test coverage

- Files: `apps/api/src/modules/attendance/application/queries/list-punches.query.test.ts` (modify), `apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.test.ts` (create), `packages/contracts/src/attendance/punch.contract.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (create), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (modify), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (create)

Baseline: `pnpm check` green before writing tests. Layers domain and e2e do not apply (per plan).

| Behavior (plan / code)                                                      | Source                                                     | Layer       | Test                                                                                          | State         |
| --------------------------------------------------------------------------- | ---------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------- | ------------- |
| Holding sees all punches, enriched with owner or `null`                     | `list-punches.query.ts:25-47`                              | application | `list-punches.query.test.ts › holding: ve todas…`                                             | CONFIRMED     |
| Company scope restricts to the company's RFC pins and enriches              | `list-punches.query.ts:28-34`                              | application | `… › permiso de una empresa…`, `… › permisos de varias empresas…`                             | CONFIRMED     |
| Company with no RFC pins: empty page, keeps pagination, no owners lookup    | `list-punches.query.ts:30-32`                              | application | `… › empresa sin RFC registrados…`                                                            | CONFIRMED     |
| Caller filters AND company scope; other company's PIN does not leak         | `list-punches.query.ts:33`, `prisma-attendance.queries.ts` | application | `… › los filtros del llamador se combinan…`                                                   | CONFIRMED     |
| Owners requested only for the returned page's PINs                          | `list-punches.query.ts:36`                                 | application | `… › pide los dueños solo de los PIN de la página…`                                           | CONFIRMED     |
| Adapter maps `findByRfcs` by RFC, dedupes pins, delegates `rfcsInCompanies` | `employees-punch-owner-directory.ts:12-27`                 | application | `employees-punch-owner-directory.test.ts` (3 tests)                                           | CONFIRMED     |
| `PunchSchema.employee` nullable object, required, uuid ids                  | `punch.contract.ts:13-16`                                  | contract    | `punch.contract.test.ts › PunchSchema.employee` (7 cases)                                     | CONFIRMED     |
| HR holds `attendance.punches:read` (8 grants)                               | `role-catalog.ts`                                          | contract    | `role-catalog.test.ts` (updated by the implementer)                                           | CONFIRMED     |
| AC1: admin lists both, `R` has employee, `1` null                           | `list-punches.query.ts`                                    | http        | `attendance-attribution.test.ts › HOLDING_ADMIN lista ambas…`                                 | CONFIRMED     |
| AC2: HR of A sees only `R` (filters apply); HR of B gets 200 empty          | `list-punches.query.ts`                                    | http        | `… › HR de la empresa A…`, `… › HR de la empresa B…`, `… › HR de una empresa sin ningún RFC…` | CONFIRMED     |
| AC3: punch before RFC becomes attributed after PUT rfc, no reprocessing     | read-time lookup                                           | http        | `… › una marcación anterior al RFC…`, `… › HR corrige el RFC…`                                | CONFIRMED     |
| AC4: terminated colaborador stays attributed                                | `findByRfcs` does not filter by status                     | http, int   | `… › un colaborador desvinculado conserva…`, int `… desvinculado sigue siendo dueño…`         | CONFIRMED     |
| AC5: anonymous 401, no-permission 403                                       | route `requires`                                           | http        | `… › sin sesión: 401…; sin rol: 403`                                                          | CONFIRMED     |
| AC6: real SenseFace 2A enrolled with RFC                                    | n/a                                                        | e2e         | `… › it.skip('NOT CONFIRMED: …')`                                                             | NOT CONFIRMED |
| `listPunches` with `pins`: IN, order/total, unknown pins                    | `prisma-attendance.queries.ts:50-56`                       | integration | `prisma-attendance.int.test.ts › pins restringe…`                                             | CONFIRMED     |
| `pins: []` returns no rows                                                  | `prisma-attendance.queries.ts` (Prisma `in: []`)           | integration | `… › pins vacío no devuelve filas`                                                            | CONFIRMED     |
| `pin` AND `pins` combine; `pins` with device and range                      | `prisma-attendance.queries.ts:50-56`                       | integration | `… › pins y pin se combinan con AND`, `… › pins se combina con equipo y rango`                | CONFIRMED     |
| `EmployeesPunchOwnerDirectory` over the real employees adapters             | `employees-punch-owner-directory.ts`                       | integration | `employees-punch-owner-directory.int.test.ts` (4 tests)                                       | CONFIRMED     |

No GAPs found.

## Review findings

## Verification
