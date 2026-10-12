---
status: verify
module: employees
min_implementer: mid
depends_on: []
---

# 001 — Termination endpoint

## Context

**What exists today.**

- The aggregate already models termination: `Employee.terminate(terminationDate, now)`
  (`apps/api/src/modules/employees/domain/employee.ts:111-123`) rejects a second termination and
  a date before `hireDate` with plain `BusinessRuleViolationError`s (code
  `BUSINESS_RULE_VIOLATION`), sets `status: 'TERMINATED'` and records `EMPLOYEE_TERMINATED` with
  `{ employeeId, terminationDate }` (`employee.ts:121`). The date is **not stored**: the props
  (`employee.ts:21-34`) have no termination field, and neither does the `Employee` model
  (`apps/api/prisma/schema.prisma:62-86`).
- Nothing calls `terminate` in production code: the router has no termination route
  (`apps/api/src/modules/employees/http/employees.router.ts:11-38`) and the contract has none
  (`packages/contracts/src/employees/employee.contract.ts:118-204`).
- `EMPLOYEE_TERMINATED` already has two consumers: identity disables the colaborador's access
  (`apps/api/src/modules/identity/identity.module.ts:185-196`) and attendance reconciles the
  colaborador on the checadores (`apps/api/src/modules/attendance/attendance.module.ts:108-120`).
  Both read only `employeeId` from the payload, so this plan does not change the payload.
- Permissions: `PERMISSIONS` (`packages/domain/src/identity/access.ts:6-23`) has
  `employees:read|register|update`. HR gets them in
  `apps/api/src/modules/identity/domain/role-catalog.ts:16-32`; HOLDING_ADMIN gets every
  permission (`role-catalog.ts:15`). `role-catalog.test.ts:19-34` pins HR's exact list.
- Shared vocabulary pattern: `EMPLOYEE_STATUSES` lives in
  `packages/domain/src/employees/employee-status.ts:1-3`, is re-exported by
  `packages/domain/src/index.ts:6`, and the contract derives its enum from it
  (`employee.contract.ts:7`). Prisma keeps its own enum (`schema.prisma:55-60`).
- Every exported error class is checked against the hand-written `API_ERRORS` catalog
  (`packages/contracts/src/errors.ts`) by `apps/api/tests/error-catalog.test.ts:19-25`; a new
  error without a catalog entry fails `pnpm check`.
- Date-only inputs are parsed as UTC midnight: `new Date(`${input.hireDate}T00:00:00Z`)`
  (`apps/api/src/modules/employees/application/commands/register-employee.command.ts:86`).

**Approach.** Add a `POST /companies/:companyId/employees/:employeeId/termination` command that
calls the existing `terminate`, extended to take a reason, and store date and reason as two
nullable columns on `employees.employees`. Alternative considered: a separate
`employees.terminations` table (history of terminations and rehires). Rehiring is not in scope
and a colaborador has at most one termination today, so two columns are enough and keep the
aggregate in one row; a history table can come with rehiring. Each rule gets its own error code
instead of the generic `BUSINESS_RULE_VIOLATION`, so clients can tell them apart.

"Today" for the no-future rule (README decision 4) is the **UTC date** of `clock.now()`: the
date is UTC midnight, and it is rejected when it is later than `now`. For a sede in Mexico this
accepts "tomorrow" (local) during the last 5–8 hours of the local day. That tolerance is accepted
here because the sede's time zone is not in the employees module (it lives in organization); see
Out of scope.

**Files imitated.** Command: `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.ts:1-51`
(find → company check → aggregate → save → publish). Route:
`employee.contract.ts:162-179` (`assignEmployeeRfc`, 204 with `z.undefined()`) and
`employees.router.ts:27-30`. Errors: `apps/api/src/modules/employees/domain/errors.ts:27-33`
(`RfcNotApplicableError`, a `BusinessRuleViolationError` with `override readonly code`).

**README decisions applied:** 2 (date + reason), 3 (reason catalog), 4 (no future dates),
5 (`employees:terminate`).

## Out of scope

- Rehiring or undoing a termination; a terminated colaborador stays terminated.
- Scheduled (future-dated) terminations and any job (decision 4).
- Finiquito / liquidación calculations, or any rule that depends on the reason.
- A free-text note on the termination (decision 2).
- Rejecting RFC or sede changes on a terminated colaborador (`AssignEmployeeRfc`,
  `AssignEmployeeSite` stay as they are).
- Using the sede's time zone for "today".
- Changing the `EMPLOYEE_TERMINATED` payload or its consumers in identity and attendance.
- Web and mobile screens.

## Dependencies

None

## Steps

1. **Reason vocabulary**
   - Files: `packages/domain/src/employees/termination-reason.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do: following `employee-status.ts:1-3`, export
     `TERMINATION_REASONS = ['VOLUNTARY_RESIGNATION', 'DISMISSAL_WITH_CAUSE', 'DISMISSAL_WITHOUT_CAUSE', 'MUTUAL_AGREEMENT', 'END_OF_CONTRACT', 'DEATH', 'INCAPACITY', 'OTHER'] as const`
     and `type TerminationReason`. Add a Spanish docblock: the closed catalog of README
     decision 3 (LFT arts. 47, 51, 53). Re-export it from `index.ts` next to line 6.
   - Observable result: `import { TERMINATION_REASONS, type TerminationReason } from '@rrhh/domain'` type-checks.

2. **Permission `employees:terminate`**
   - Files: `packages/domain/src/identity/access.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify)
   - Do: add `'employees:terminate'` after `'employees:update'` in `PERMISSIONS` (`access.ts:13`)
     and in HR's list (`role-catalog.ts:23`). In `role-catalog.test.ts:28`, add the same string to
     the expected HR list. Nothing else changes in that test.
   - Observable result: HOLDING_ADMIN and HR actors carry `employees:terminate`; `role-catalog.test.ts` passes.

3. **Contract: errors, input, route, read model**
   - Files: `packages/contracts/src/errors.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do:
     - `errors.ts`: after `RFC_NOT_APPLICABLE` (line 225), add three entries, all `status: 422`,
       whose `message`s are exactly those of step 4:
       `EMPLOYEE_ALREADY_TERMINATED` (description: the colaborador was already terminated;
       `details: { employeeId: EMPLOYEE_ID }`), `TERMINATION_DATE_IN_FUTURE` (the date is later
       than today, UTC; no details), `TERMINATION_BEFORE_HIRE` (the date is before the hire date;
       `details: { hireDate: '2026-01-10' }`).
     - `employee.contract.ts`: import `TERMINATION_REASONS`; add
       `TerminationReasonSchema = z.enum(TERMINATION_REASONS)`. Add to `EmployeeListItemSchema`
       (lines 10-22) `terminationDate: z.iso.date().nullable()` ("Fecha de baja (YYYY-MM-DD); null
       si está activo") and `terminationReason: TerminationReasonSchema.nullable()` ("Motivo de la
       baja; null si está activo"). Add `TerminateEmployeeSchema` with
       `terminationDate: z.iso.date()` ("Fecha de baja (YYYY-MM-DD); hoy o anterior, no antes de
       la contratación") and `reason: TerminationReasonSchema`, `.meta({ id: 'TerminateEmployeeInput' })`,
       plus its `z.input` type, following `AssignEmployeeSiteSchema` (lines 90-95). Add route
       `terminateEmployee`: `POST /companies/:companyId/employees/:employeeId/termination`,
       summary "Da de baja (desvincula) a un colaborador", a description in the same 3-paragraph
       format as `assignEmployeeSite` (who: holding admin, or HR if the company is in scope;
       needs date ≤ today and ≥ hire date, and a reason; effects: the colaborador becomes
       TERMINATED, loses platform access and is removed from their sede's checadores),
       `errors: ['EMPLOYEE_NOT_FOUND', 'EMPLOYEE_ALREADY_TERMINATED', 'TERMINATION_DATE_IN_FUTURE', 'TERMINATION_BEFORE_HIRE']`,
       `access: requires('employees:terminate', { companyParam: 'companyId' })`,
       `params: EmployeeParams`, `body: TerminateEmployeeSchema`, `response: z.undefined()`,
       `successStatus: 204`.
     - `openapi.json`: regenerate with `pnpm --filter @rrhh/contracts openapi`; never edit it by hand.
   - Observable result: `employeeRoutes.terminateEmployee` exists; the OpenAPI snapshot shows the
     new path, the two list fields and the three errors.

4. **Domain: stored termination, reason and specific errors**
   - Files: `apps/api/src/modules/employees/domain/errors.ts` (modify), `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify)
   - Do:
     - `errors.ts`: three classes extending `BusinessRuleViolationError` with
       `override readonly code` (shape of `RfcNotApplicableError`, lines 27-33):
       `EmployeeAlreadyTerminatedError(employeeId: string)` → `EMPLOYEE_ALREADY_TERMINATED`,
       message `'El colaborador ya está desvinculado'`, details `{ employeeId }`;
       `TerminationDateInFutureError()` → `TERMINATION_DATE_IN_FUTURE`, message
       `'La fecha de baja no puede ser posterior a hoy'`;
       `TerminationBeforeHireError(hireDate: string)` → `TERMINATION_BEFORE_HIRE`, message
       `'La fecha de baja es anterior a la contratación'`, details `{ hireDate }`.
     - `employee.ts`: export `interface EmployeeTermination { date: Date; reason: TerminationReason }`;
       add `termination: EmployeeTermination | null` to `EmployeeProps` with a docblock (null while
       active; may also be null on a TERMINATED row from before the field). `hire` sets
       `termination: null`. `restore` takes
       `props: Omit<EmployeeProps, 'termination'> & { termination?: EmployeeTermination | null }`
       and stores `termination: props.termination ?? null`, so the existing callers of `restore`
       (tests, fixtures) keep compiling untouched. Change `terminate` to
       `terminate(input: { date: Date; reason: TerminationReason }, now: Date)`, with checks in
       this order: already TERMINATED → `EmployeeAlreadyTerminatedError(this.id)`;
       `input.date > now` → `TerminationDateInFutureError`; `input.date < hireDate` →
       `TerminationBeforeHireError(hireDate as YYYY-MM-DD)`. On success set
       `status: 'TERMINATED'` and `termination: { date, reason }`, and record the event with the
       **same payload as today** (`{ employeeId: this.id, terminationDate: input.date }`). Update
       the docblock at line 110.
     - `employee.test.ts`: only adapt the three existing calls (lines 190, 198, 204-205) to the
       new signature, passing `reason: 'VOLUNTARY_RESIGNATION'`. New tests are the tester's job.
   - Observable result: `pnpm --filter @rrhh/api typecheck` (or `pnpm check`) compiles; the three
     existing terminate tests pass.

5. **Command `TerminateEmployee`**
   - Files: `apps/api/src/modules/employees/application/commands/terminate-employee.command.ts` (create)
   - Do: copy the shape of `assign-employee-rfc.command.ts:1-51`. Input
     `{ companyId; employeeId; terminationDate: string; reason: TerminationReason }`; deps
     `employeeRepository`, `clock`, `eventBus`. Find the colaborador; another company's →
     `EmployeeNotFoundError` (same comment as `assign-employee-rfc.command.ts:33`). Parse the date
     as `new Date(`${input.terminationDate}T00:00:00Z`)` (as `register-employee.command.ts:86`),
     call `employee.terminate({ date, reason }, clock.now())`, return its `err` as is, save,
     publish `pullEvents()`, return `ok(undefined)`. Docblock: not idempotent, a second call
     answers `EMPLOYEE_ALREADY_TERMINATED`.
   - Observable result: the class compiles with `Command<TerminateEmployeeInput, undefined>`.

6. **Persistence: schema, migration, mapper, directory query**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261012154547_add_employee_termination/migration.sql` (create), `apps/api/src/modules/employees/infrastructure/employee.mapper.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts` (modify)
   - Do:
     - `schema.prisma`: after `enum EmployeeStatus` (lines 55-60) add `enum TerminationReason`
       with the 8 values of step 1 and `@@schema("employees")`. In `model Employee`, after
       `status` (line 77): `terminationDate DateTime? @map("termination_date") @db.Date` and
       `terminationReason TerminationReason? @map("termination_reason")`, each with a `///`
       comment (null while active).
     - Generate the migration with `pnpm db:migrate --name add_employee_termination` (follow the
       `db-change` skill); do not hand-write the SQL nor edit existing migrations. Run
       `pnpm db:generate` if the client is not regenerated.
     - `employee.mapper.ts`: `toDomain` passes `termination` = `{ date: row.terminationDate, reason: row.terminationReason }`
       when both are non-null, else `null`. `toPersistence` writes
       `terminationDate: s.termination?.date ?? null` and
       `terminationReason: s.termination?.reason ?? null`.
     - `prisma-employee.queries.ts`: in `listDirectory`, add `terminationDate: true` and
       `terminationReason: true` to the `select` (lines 44-56) and map them like `hireDate`
       (line 77): `terminationDate: row.terminationDate?.toISOString().slice(0, 10) ?? null`,
       `terminationReason: row.terminationReason`.
   - Observable result: the migration applies on the dev and `rrhh_test` databases; existing
     rows read back with `termination: null`.

7. **HTTP route and DI registration**
   - Files: `apps/api/src/modules/employees/http/employees.router.ts` (modify), `apps/api/src/modules/employees/employees.module.ts` (modify)
   - Do: add `terminateEmployee: TerminateEmployee` to the router deps and bind
     `routes.terminateEmployee` like `assignEmployeeRfc` (lines 27-30):
     `unwrap(await deps.terminateEmployee.execute({ ...params, ...body }))`, return `undefined`.
     Register `terminateEmployee: asClass(TerminateEmployee).singleton()` and add it to
     `EmployeesCradle` (lines 20-30) and to `registrations` (lines 34-44).
   - Observable result: `tests/container.test.ts` resolves `terminateEmployee`; the route answers.

8. **Adapt existing tests to the new signature, permission and fields** (added by the
   implementer: Deviations 1–3)
   - Files: `apps/api/tests/invitations.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (modify), `apps/api/tests/attendance-device-sync.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `apps/api/tests/test-app.ts` (modify), `packages/contracts/src/employees/employee.contract.test.ts` (modify)
   - Do: mechanical only — pass a `reason`, keep termination dates within each test's clock,
     update hard-coded counts, add the two list fields to fixtures. No assertion changes.
   - Observable result: existing suites stay green.

9. **New test files and initiative bookkeeping** (added after review Low-1 and Low-2)
   - Files: `apps/api/src/modules/employees/application/commands/terminate-employee.command.test.ts` (create), `apps/api/tests/employee-termination.test.ts` (create), `plans/identity-acceso/README.md` (modify)
   - Do: the tester's two new test files (see Test coverage); the identity README fix the user
     asked for together with this plan (Deviation 5).
   - Observable result: `pnpm plans:scope` passes.

## Acceptance criteria

- [ ] `POST /api/v1/companies/:companyId/employees/:employeeId/termination` with
      `{ "terminationDate": "<today or earlier>", "reason": "VOLUNTARY_RESIGNATION" }` as
      HOLDING_ADMIN answers **204**; the directory (`GET /companies/:companyId/employees`) then
      shows that colaborador with `status: "TERMINATED"`, that `terminationDate` and that
      `terminationReason`.
- [ ] Active colaboradores appear in the directory with `terminationDate: null` and
      `terminationReason: null`.
- [ ] A second termination of the same colaborador → **422** `EMPLOYEE_ALREADY_TERMINATED`.
- [ ] A date later than today (UTC) → **422** `TERMINATION_DATE_IN_FUTURE`.
- [ ] A date before the hire date → **422** `TERMINATION_BEFORE_HIRE`, with `details.hireDate`.
- [ ] A reason outside the catalog, or a missing/badly formatted date → **400** (request validation).
- [ ] Unknown colaborador, or one from another company → **404** `EMPLOYEE_NOT_FOUND`.
- [ ] HR of the colaborador's company can terminate (204); HR of another company → 403; no
      session → 401.
- [ ] After a termination, the colaborador's user (if they had one) can no longer sign in, and
      a `DELETE USERINFO` command for their RFC is queued for each checador of their sede that
      has allowed networks (existing consumers of `EMPLOYEE_TERMINATED`).
- [ ] `employees.employees` has `termination_date` and `termination_reason` filled for that row.
- [ ] `pnpm check` and `pnpm test:integration` pass; `/docs` (Scalar) shows the new endpoint
      with its three errors.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                               |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `terminate`: stores date and reason; each of the three errors and their order; event payload unchanged.                                             |
| application | yes     | `TerminateEmployee` with in-memory repo: happy path saves + publishes; other company → NOT_FOUND; errors pass through; nothing published on error.  |
| contract    | yes     | `TerminateEmployeeSchema` (reason enum, date format); route access `employees:terminate` scoped to the path company; list item new nullable fields. |
| http        | yes     | Status codes and error codes of the acceptance criteria, permissions (admin, HR own/other company, anonymous).                                      |
| integration | yes     | Prisma round-trip of `termination` (save/find and `listDirectory`), and an untouched row reading back null.                                         |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                         |

## Deviations

Implemented inline in the main session (2026-10-12). All cosmetic: no design or scope impact.

1. **More callers of `terminate` than the plan listed.** Plan said only `employee.test.ts` calls
   it; reality: 9 more calls in 5 test files (`invitations.test.ts:203,430`,
   `attendance-attribution.test.ts:231`, `attendance-device-sync.test.ts:418`,
   `prisma-employee.int.test.ts:72,290,397,451`, `employees-punch-owner-directory.int.test.ts:95`).
   Done: same mechanical adaptation (add `reason: 'VOLUNTARY_RESIGNATION'`). In the two
   integration files and in `employee.test.ts` the old date (2026-02-01) is later than the
   test's `NOW` (2026-01-15) and would now hit `TERMINATION_DATE_IN_FUTURE`, so it moved to
   2026-01-12 (after the 2026-01-10 hire; 2026-01-12 for the second call in `employee.test.ts`).
   No assertion changed.
2. **Hard-coded counts tied to the new permission and route.** HR now has 10 grants, not 9
   (`role-catalog.test.ts:68,79`, `session-authenticator.test.ts:141,171`), and the OpenAPI
   document has 32 operations, not 31 (`openapi.test.ts:49`). Counts updated.
3. **Fixtures that build `EmployeeListItem`.** The in-memory `listDirectory` of
   `tests/test-app.ts:91-110` and the `item` fixture of `employee.contract.test.ts:186-195` must
   carry the two new fields; added (from `snapshot.termination` and as `null`).
4. **Migration name.** Generated as `20261012154547_add_employee_termination`; the SQL only
   creates the enum and adds two nullable columns (no `DROP`).
5. **`plans/identity-acceso/README.md` rides on this branch** (review Low-2). The user asked, in
   the same request that started this initiative (2026-10-12), to fix that README's stale
   "Delivered" section (it said plan 005 was pending). It went into this plan's draft commit
   `ca3c5ed`. Kept here on purpose; declared in step 9. Docs only, no code.

Evidence: `pnpm check` green; `pnpm test:integration` 17 files / 218 tests passed.

## Test coverage

Written inline (2026-10-12). Baseline = the implementation's closing run (`pnpm check` green,
integration 218/218). Closing run: `pnpm check` green; `pnpm test:integration` 17 files /
222 tests passed. New tests: domain 11, application 8, contract 25, http 15 (13 in the new file,
1 in `attendance-device-sync.test.ts`, 1 in `invitations.test.ts`), integration 4. One HTTP
assertion first assumed `PERMISSION_DENIED` for 403; the code says `FORBIDDEN`
(`apps/api/src/http/request-context.ts:28`), test corrected to the code. No GAP, nothing
NOT CONFIRMED. The 2 skipped tests in `invitations.test.ts`/`attendance-device-sync.test.ts`
were already there.

| Behavior (from plan / code)                                     | Source (`file:line`)                                               | Layer       | Test                                                                                                           | State     |
| --------------------------------------------------------------- | ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------- | --------- |
| Hire starts with `termination: null`                            | `employee.ts:112`                                                  | domain      | `employee.test.ts › al contratar no tiene baja registrada`                                                     | CONFIRMED |
| Stores date and reason                                          | `employee.ts:133-150`                                              | domain      | `› guarda la fecha y el motivo de la baja`                                                                     | CONFIRMED |
| Event payload unchanged `{ employeeId, terminationDate }`       | `employee.ts:133-150`                                              | domain      | `› el evento conserva el payload …`                                                                            | CONFIRMED |
| Today (UTC) accepted; same day as hire accepted                 | `employee.ts:140-141`                                              | domain      | `› acepta la fecha de hoy (UTC)…`, `› acepta la baja el mismo día de la contratación`                          | CONFIRMED |
| `TERMINATION_DATE_IN_FUTURE`, no state change, no event         | `employee.ts:140`, `errors.ts`                                     | domain      | `› TERMINATION_DATE_IN_FUTURE si la fecha es posterior a hoy…`                                                 | CONFIRMED |
| `TERMINATION_BEFORE_HIRE` with `details.hireDate`               | `employee.ts:141`                                                  | domain      | `› TERMINATION_BEFORE_HIRE con la fecha de contratación en details`                                            | CONFIRMED |
| `EMPLOYEE_ALREADY_TERMINATED`, first termination kept           | `employee.ts:138`                                                  | domain      | `› EMPLOYEE_ALREADY_TERMINATED en la segunda baja…`                                                            | CONFIRMED |
| Rule order: terminated > future > before hire                   | `employee.ts:137-143`                                              | domain      | `› ya desvinculado gana…`, `› fecha futura gana…`                                                              | CONFIRMED |
| `restore` without `termination` → null                          | `employee.ts:125`                                                  | domain      | `› restore sin termination (fila anterior al campo)…`                                                          | CONFIRMED |
| Command: parses date as UTC midnight, saves, publishes          | `terminate-employee.command.ts:40-48`                              | application | `terminate-employee.command.test.ts › da de baja: guarda fecha…`, `› acepta la fecha de hoy según el reloj`    | CONFIRMED |
| Unknown / other company → `EMPLOYEE_NOT_FOUND`, untouched       | `terminate-employee.command.ts:35-38`                              | application | `› EMPLOYEE_NOT_FOUND si el colaborador no existe`, `› … si es de otra empresa…`                               | CONFIRMED |
| Domain errors pass through; nothing saved/published on error    | `terminate-employee.command.ts:44`                                 | application | `› TERMINATION_DATE_IN_FUTURE: mañana…`, `› TERMINATION_BEFORE_HIRE…`, `› EMPLOYEE_ALREADY_TERMINATED…`        | CONFIRMED |
| `save` err propagated, no event                                 | `terminate-employee.command.ts:46-47`                              | application | `› propaga el err de save y no publica`                                                                        | CONFIRMED |
| Body schema: 8 reasons, required fields, ISO date               | `employee.contract.ts:105-112`                                     | contract    | `employee.contract.test.ts › TerminateEmployeeSchema` (18)                                                     | CONFIRMED |
| Route: POST path, 204, `employees:terminate` scoped, 4 errors   | `employee.contract.ts:222-245`                                     | contract    | `› employeeRoutes.terminateEmployee` (4)                                                                       | CONFIRMED |
| List item: two nullable, required fields                        | `employee.contract.ts:22-28`                                       | contract    | `› EmployeeListItemSchema › baja` (3)                                                                          | CONFIRMED |
| HR has `employees:terminate`                                    | `role-catalog.ts:24`                                               | domain      | `role-catalog.test.ts › HR: alcance empresa…` (updated list)                                                   | CONFIRMED |
| 204 + directory shows TERMINATED, date, reason; active → nulls  | `employees.router.ts`, `test-app.ts` in-memory directory           | http        | `employee-termination.test.ts › 204 y el directorio…`, `› un colaborador activo…`, `› 204 con la fecha de hoy` | CONFIRMED |
| 422 bodies of the three new errors                              | `errors.ts` (contracts + employees)                                | http        | `› 422 EMPLOYEE_ALREADY_TERMINATED…`, `› 422 TERMINATION_DATE_IN_FUTURE…`, `› 422 TERMINATION_BEFORE_HIRE…`    | CONFIRMED |
| 400 on bad reason / missing or malformed date                   | `employee.contract.ts:105-112`                                     | http        | `› 400 VALIDATION_ERROR con un motivo…`, `› 400 VALIDATION_ERROR sin fecha…`                                   | CONFIRMED |
| 404 unknown / other company, same body                          | `terminate-employee.command.ts:35-38`                              | http        | `› 404 EMPLOYEE_NOT_FOUND…` (2)                                                                                | CONFIRMED |
| HR own company 204, HR other company 403, anonymous 401         | `employee.contract.ts:239`, `role-catalog.ts:24`                   | http        | `› RH de la empresa…`, `› 403 para RH de otra empresa…`, `› 401 sin sesión`                                    | CONFIRMED |
| Endpoint termination → `DELETE USERINFO` on the sede's checador | `attendance.module.ts:108-120`                                     | http        | `attendance-device-sync.test.ts › la baja por el endpoint … da DELETE del PIN`                                 | CONFIRMED |
| Endpoint termination → session closed, login refused            | `identity.module.ts:185-196`                                       | http        | `invitations.test.ts › la baja por el endpoint … cierra la sesión y el login`                                  | CONFIRMED |
| Prisma round-trip of date (DATE column) and reason              | `employee.mapper.ts:31-33,52-53`                                   | integration | `prisma-employee.int.test.ts › guarda y rehidrata fecha … y motivo`                                            | CONFIRMED |
| Active row and pre-field TERMINATED row read back null          | `employee.mapper.ts:31-33`                                         | integration | `› un activo se rehidrata…`, `› una fila TERMINATED sin fecha ni motivo…`                                      | CONFIRMED |
| `listDirectory` returns the two fields                          | `prisma-employee.queries.ts:56-57,81-82`                           | integration | `› listDirectory devuelve fecha y motivo…`                                                                     | CONFIRMED |
| Migration applies on `rrhh_test`                                | `migrations/20261012154547_add_employee_termination/migration.sql` | integration | whole `pnpm test:integration` run                                                                              | CONFIRMED |

## Review findings

Reviewer (subagent), 2026-10-12. Diff `main...HEAD` (3 commits), working tree clean.

**Checklist: 12/13. FAIL: plans:scope.**

- [ ] `pnpm plans:scope`: **fails** (exit 1). See Low-1 and Low-2. Hot files: the
      `schema.prisma` change adds the enum and two columns. The other changed lines in `model
Employee` only realign columns (whitespace from `prisma format`), so I accept it as
      append-only. `test-app.ts` is declared in step 8.
- [x] `pnpm check` green (format, typecheck, lint, tests, arch, plans:lint, harness, quality).
- [x] `pnpm test:integration`: 17 files / 222 tests passed.
- [x] Business rules only in `Employee.terminate` (`employee.ts:133-150`). Router, mapper and
      queries only map values.
- [x] CQRS-lite: `TerminateEmployee` goes find → aggregate → `save` → publish and returns
      `Result`. The directory goes through `EmployeeQueries`. The repository has no new methods.
- [x] Types come from `@rrhh/contracts` / `@rrhh/domain` (`TERMINATION_REASONS` is shared;
      Prisma keeps its own enum, as with `EmployeeStatus`).
- [x] There are three domain errors with stable codes, and the `API_ERRORS` messages match them
      exactly. The `error-catalog` test is green.
- [x] Dates are UTC midnight (`terminate-employee.command.ts:41`) and "today" comes from
      `clock.now()`. No money is involved.
- [x] The migration is new (`20261012154547_add_employee_termination`). Its SQL only does
      `CREATE TYPE` and adds two nullable columns: no DROP, no FK.
- [x] DI: registered once in `employees.module.ts`, and `container.test.ts` is green.
- [x] No secrets or real personal data. The fixtures use `*.example` and a synthetic CURP.
- [x] Deviations are honest. I spot-checked 1 and 2: the dates moved to 2026-01-10/12 in
      `employee.test.ts`, HR went 9→10 and 18→20 in `role-catalog.test.ts`, and the authenticator
      went 9→10.
- [x] Docs: `docs/architecture.md:144-146` (the identity subscription) is still accurate. No doc
      lists permissions or endpoints by hand. `docs/conventions.md:82` uses
      `employee.terminate(date)` only to illustrate "tell, don't ask", so it is not a stale
      description (no finding).

**Findings: 0 High, 1 Medium (out of scope → finding), 2 Low.**

- **Medium-1 (out of scope, now reachable; recorded in
  `plans/hallazgos/employees-guardado-completo-pisa-la-baja.md`).**
  `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:43-47` does an
  `upsert` of the whole row with no version check. `TerminateEmployee`
  (`terminate-employee.command.ts:34,46`) and `AssignEmployeeSite`
  (`assign-employee-site.command.ts:39,53`) both load the row and then save the whole thing.
  - Scenario: a site change runs concurrently with a termination. The PUT saves after the
    termination, which writes back `status: ACTIVE` and nulls `termination_*`. The colaborador
    shows as active with no termination, identity already disabled their access, and attendance
    adds them back to the new sede's checadores (`EMPLOYEE_SITE_ASSIGNED` → `syncEmployee`).
  - A double POST can also return 204 twice and publish two `EMPLOYEE_TERMINATED` events.
  - Not reproduced: the window is the time between `findById` and `save`. The pattern existed
    before this plan, but this plan's endpoint is what makes it reachable.
  - It does not block this plan. It is the user's call whether it becomes a plan.
- **Low-1: two test files are not declared in the plan.**
  `apps/api/src/modules/employees/application/commands/terminate-employee.command.test.ts` and
  `apps/api/tests/employee-termination.test.ts` were created by the tester, appear in `## Test
coverage` and are legitimate. But no `Files:` line names them, so `plans:scope` reports them as
  out of scope. Earlier plans (for example `attendance-marcaciones/002`, its tests step) declare
  the test files. Fix: add them to a `Files:` line (plan only, no code change).
- **Low-2: `plans/identity-acceso/README.md` is not in this plan.** It was changed in commit
  `ca3c5ed` (the draft of this plan) to rewrite the "Delivered" section of another initiative.
  - The content looks correct, but it is outside the plan and outside this initiative.
    `plans:scope` reports it.
  - Failure scenario: the PR for `feat/employees-desvinculacion` mixes in the closing of
    `identity-acceso`, and reverting the branch would also revert that closing.
  - Fix: the main session decides whether to move it to its own `docs(identity)` commit/branch
    or to declare it explicitly as a deviation. No product code is involved.

Bug hunt, no defects found:

- End-to-end trace: the contract (`z.iso.date()` rejects impossible dates such as `2026-02-30`;
  closed enum) → command → domain (rule order matches the plan; today's UTC midnight is ≤ `now`)
  → mapper (date and reason, or null) → directory → 204.
- Tenancy: another company → 404. HR of another company → 403 (by `companyParam`).
- Payload of `EMPLOYEE_TERMINATED`: unchanged.

Status stays `review`: the scope checklist item fails. Low-1 and Low-2 need only plan/commit
bookkeeping (no product code changes). Once they are resolved and `pnpm plans:scope` passes, the
plan can move to `verify`.

**Resolution (main session, 2026-10-12):** Low-1 → the two test files are declared in step 9.
Low-2 → declared as Deviation 5 and in step 9 (the user asked for that README fix with this
plan). `pnpm plans:scope` passes. Medium-1 stays as the open finding
`plans/hallazgos/employees-guardado-completo-pisa-la-baja.md` for the user to triage. No code
changed, so the review verdict holds. Plan to `verify`.

## Verification
