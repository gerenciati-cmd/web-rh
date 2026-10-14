---
status: verify
module: attendance
min_implementer: mid
depends_on: []
---

# 001 — Shift catalog and assignment

## Context

**Today.** Attendance stores raw marcaciones only: device, PIN (= RFC), device local time, UTC
instant and the device's `status`/`verifyMode` codes
(`apps/api/src/modules/attendance/domain/punch.ts:15-25`,
`apps/api/prisma/schema.prisma:295-313`). There are no shifts, schedules or jornadas in the schema
(`apps/api/prisma/schema.prisma:233-313`). A colaborador has a company, a sede, a status and a hire
date (`apps/api/prisma/schema.prisma:76-104`); other modules see them through
`EmployeesApi.findEmployee`, which returns `companyId` and `active`
(`apps/api/src/modules/employees/application/employees.facade.ts:7-15,39-52`). Companies are
reached through `OrganizationApi.findCompany`
(`apps/api/src/modules/organization/application/organization.facade.ts:29-30`).

**Need.** README decisions 2, 3, 5, 6, 11 and 12: each company defines shifts as a cyclic pattern
and HR assigns one to each colaborador from a date. Plan 002 will resolve "which shift day applies
on date D" from what this plan stores.

**Approach.** A `Shift` aggregate owned by a company holds its cycle as a list of days stored as
one JSONB column (the cycle is always read and written whole; there is nothing to query inside
it). A `ShiftAssignment` row per (colaborador, effective date) holds the history. Compared with
(a) separate tables for cycle days — more joins and a second write path for no query benefit —
and (b) a weekly-only model with a separate rotation entity — two shapes to resolve (README
"Considered and discarded"), the JSONB cycle is the smallest model that covers fixed, rotating
and night shifts.

**Architect's choices (confirm on approval).**

- **A cycle day** is `{ type: 'REST' }` or `{ type: 'WORK', start: 'HH:mm', end: 'HH:mm',
mealBreakMinutes }`. When `end` ≤ `start` the shift ends the next day (night shift, decision
  12); `end` = `start` means 24 hours (a 24x24 shift). The meal break is per working day so a
  half-day Saturday can have none; it must be shorter than the day's duration.
- **Cycle length** 1–28 days, at least one working day. `cycleStartDate` is the date on which day
  1 of the cycle falls; dates before it also resolve (the cycle repeats backwards).
- **Tolerance** (decision 6) 0–60 minutes; **meal break** 0–120 minutes.
- **Name** unique per company, case-insensitive, 1–100 characters (as sedes do with `nameKey`,
  `apps/api/prisma/schema.prisma:41-42`).
- **Assigning** the same colaborador on an `effectiveFrom` that already has an assignment
  **replaces** it (idempotent `PUT`), so HR can correct a mistake without a delete endpoint.
  Past and future dates are accepted; 002 recalculates.
- **No check against the hire date** in this plan (`EmployeesApi` does not expose it); 002 only
  builds jornadas from the hire date on.
- **Permissions** `attendance.shifts:read` and `attendance.shifts:manage`, granted to HR (company
  scope) and HOLDING_ADMIN (all permissions), following decision 11.

**Imitated files.** Contract shape: `packages/contracts/src/employees/employee.contract.ts:129-251`
(company-scoped params and `requires(..., { companyParam })`). Command shape:
`apps/api/src/modules/attendance/application/commands/register-device.command.ts:21-58` and the
"other company = not found" rule of
`apps/api/src/modules/employees/application/commands/terminate-employee.command.ts:34-38`.
Aggregate: `apps/api/src/modules/attendance/domain/device.ts:63-114`. Query with a 404 check:
`apps/api/src/modules/attendance/application/queries/list-device-commands.query.ts:12-29`.
Cross-module adapters: `apps/api/src/modules/attendance/infrastructure/organization-site-directory.ts:1-13`
and `apps/api/src/modules/attendance/infrastructure/employees-site-roster.ts:1-30`. Prisma
repository and unique-violation handling:
`apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts:35-47`. Shared
vocabulary constants: `packages/domain/src/employees/termination-reason.ts:1-16`.

## Out of scope

- Building, storing or reading daily jornadas, retardos, faltas or horas extra (plan 002), and the
  N-retardos rule (plan 003).
- Editing, renaming or deactivating a shift, and deleting an assignment.
- Validating an assignment against the hire date; LFT maximum jornada limits (arts. 60–61) on a
  shift's hours.
- Domain events for shifts or assignments (002 adds what it needs).
- Web and mobile screens.
- Any change to the employees or organization modules.

## Dependencies

None

## Steps

1. **Shared vocabulary: permissions and shift limits**
   - Files: `packages/domain/src/identity/access.ts` (modify), `packages/domain/src/attendance/shift-rules.ts` (create), `packages/domain/src/index.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify)
   - Do: add `'attendance.shifts:read'` and `'attendance.shifts:manage'` to `PERMISSIONS` after
     `'attendance.punches:read'` (`access.ts:17`). Create `shift-rules.ts` with a docblock citing
     this README's decisions 5, 6 and 12, exporting `SHIFT_DAY_TYPES = ['WORK', 'REST'] as const`
     and its type `ShiftDayType`, `MAX_SHIFT_CYCLE_DAYS = 28`, `MAX_SHIFT_TOLERANCE_MINUTES = 60`,
     `MAX_MEAL_BREAK_MINUTES = 120`, `SHIFT_NAME_MAX_LENGTH = 100`, and
     `SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/`. Export it from `index.ts` after the
     `employees/` lines. In `role-catalog.ts` add both permissions to HR after
     `'attendance.punches:read'` with a comment citing decision 11 of
     `attendance-asistencia-diaria`. In `role-catalog.test.ts:22-35` add both permissions to the
     expected HR list (mechanical).
   - Observable result: `role-catalog.test.ts` passes; HOLDING_ADMIN gets both through `PERMISSIONS`.

2. **Contract: shifts and assignments**
   - Files: `packages/contracts/src/attendance/shift.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/src/errors.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do: in `shift.contract.ts`, following `employee.contract.ts`:
     - `ShiftDaySchema`: `z.discriminatedUnion('type', [...])` of `{ type: 'REST' }` and
       `{ type: 'WORK', start, end, mealBreakMinutes }`; `start`/`end` are strings matching
       `SHIFT_TIME_PATTERN`; `mealBreakMinutes` int 0..`MAX_MEAL_BREAK_MINUTES`, default 0.
       `.meta({ id: 'AttendanceShiftDay' })`. Describe `end`: "Hora de salida; si es menor o
       igual a la entrada, la jornada termina al día siguiente (igual = 24 horas)".
     - `CreateShiftSchema`: `name` (trim, 1..`SHIFT_NAME_MAX_LENGTH`), `cycleStartDate`
       (`z.iso.date()`, "Fecha en la que cae el día 1 del ciclo"), `toleranceMinutes` (int
       0..`MAX_SHIFT_TOLERANCE_MINUTES`), `days` (array of `ShiftDaySchema`, 1..
       `MAX_SHIFT_CYCLE_DAYS`). `.refine`: at least one `WORK` day (path `['days']`,
       "El turno necesita al menos un día laborable"). `.superRefine`: for each WORK day,
       `mealBreakMinutes` < the day's duration in minutes (path `['days', i, 'mealBreakMinutes']`,
       "La comida debe ser menor que la jornada"). Duration = `end − start` in minutes, plus 1440
       when `end ≤ start`. `.meta({ id: 'CreateAttendanceShiftInput' })`.
     - `ShiftSchema` (read): `id`, `name`, `cycleStartDate` (`z.iso.date()`), `toleranceMinutes`,
       `days`, `active`, `createdAt` (`z.iso.datetime()`). `.meta({ id: 'AttendanceShift' })`;
       export `ShiftDto`.
     - `AssignShiftSchema`: `{ shiftId: z.uuid() }`, `.meta({ id: 'AssignAttendanceShiftInput' })`.
     - `ShiftAssignmentSchema` (read): `effectiveFrom` (`z.iso.date()`), `shiftId`, `shiftName`,
       `assignedAt` (`z.iso.datetime()`), `assignedBy` (uuid).
       `.meta({ id: 'AttendanceShiftAssignment' })`; export `ShiftAssignmentDto`.
     - `attendanceShiftRoutes`, each with the "Quién puede / Necesita" description style of
       `employee.contract.ts:141-147`:
       - `listShifts`: `GET /companies/:companyId/attendance/shifts`, query `PageQuerySchema`,
         response `pageOf(ShiftSchema)`, `requires('attendance.shifts:read', { companyParam: 'companyId' })`.
       - `createShift`: `POST /companies/:companyId/attendance/shifts`, body `CreateShiftSchema`,
         response `CreatedSchema`, 201, errors `['COMPANY_NOT_FOUND', 'SHIFT_ALREADY_EXISTS']`,
         `requires('attendance.shifts:manage', { companyParam: 'companyId' })`.
       - `assignEmployeeShift`: `PUT /companies/:companyId/attendance/employees/:employeeId/shift-assignments/:effectiveFrom`
         (params `companyId`, `employeeId` uuid, `effectiveFrom` `z.iso.date()`), body
         `AssignShiftSchema`, response `z.undefined()`, 204, errors
         `['EMPLOYEE_NOT_FOUND', 'SHIFT_NOT_FOUND', { code: 'EMPLOYEE_INACTIVE', variant: 'employees' }]`,
         `requires('attendance.shifts:manage', { companyParam: 'companyId' })`. Description says an
         existing assignment on that date is replaced.
       - `listEmployeeShiftAssignments`: `GET /companies/:companyId/attendance/employees/:employeeId/shift-assignments`,
         query `PageQuerySchema`, response `pageOf(ShiftAssignmentSchema)`, errors
         `['EMPLOYEE_NOT_FOUND']`, `requires('attendance.shifts:read', { companyParam: 'companyId' })`.
         Most recent `effectiveFrom` first.
     - In `index.ts`: `export * from './attendance/shift.contract'` and
       `attendanceShifts: attendanceShiftRoutes` in `apiRoutes`.
     - In `errors.ts`, in the attendance block (`errors.ts:301-356`), add `SHIFT_NOT_FOUND` (404,
       message `'El turno no existe'`, details `{ shiftId }`) and `SHIFT_ALREADY_EXISTS` (409,
       message `'Ya existe un turno con ese nombre en la empresa'`, details `{ name }`). Add a
       `SHIFT_ID` example constant next to `errors.ts:39-42`. Extend the `EMPLOYEE_INACTIVE`
       description (`errors.ts:428-429`) with "ni asignarle un turno".
     - In `openapi.test.ts:49` change `32` to `36` (mechanical). Regenerate `openapi.json` with
       `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: `pnpm --filter @rrhh/contracts test` passes; `/docs` lists the 4 routes.

3. **Domain: `Shift` aggregate, assignment and errors**
   - Files: `apps/api/src/modules/attendance/domain/shift.ts` (create), `apps/api/src/modules/attendance/domain/shift.repository.ts` (create), `apps/api/src/modules/attendance/domain/shift-assignment.ts` (create), `apps/api/src/modules/attendance/domain/shift-assignment.repository.ts` (create), `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do:
     - `shift.ts`: `ShiftId = Id<'Shift'>`; `ShiftDay` = `{ type: 'REST' } | { type: 'WORK';
start: string; end: string; mealBreakMinutes: number }`; `ShiftProps` = `companyId`,
       `name`, `nameKey`, `cycleStartDate` (string `YYYY-MM-DD`), `toleranceMinutes`,
       `days: readonly ShiftDay[]`, `active`, `createdAt`. `class Shift extends AggregateRoot<ShiftId>`
       like `device.ts:63-114`: `static create({ id, companyId, name, cycleStartDate,
toleranceMinutes, days, now })` returning `Result<Shift, InvalidValueError>` that
       re-checks every contract rule of step 2 with `InvalidValueError` (Spanish messages);
       `nameKey` = `name.trim().toLowerCase()`; `active: true`; no events. `static restore(id,
props)`. Getters for every prop. `dayOn(date: string): ShiftDay` — index =
       `((daysBetween(cycleStartDate, date) % n) + n) % n` where `daysBetween` parses both as UTC
       midnight (`Date.UTC`) and divides by 86 400 000; docblock: a night shift's day is the date
       it starts (decision 12). Export `workMinutes(day)` for a WORK day (duration − meal, the
       duration rule of step 2).
     - `shift.repository.ts`: `findById(id: ShiftId): Promise<Shift | null>`;
       `add(shift): Promise<Result<void, ShiftAlreadyExistsError>>` (duplicate company+nameKey
       → err).
     - `shift-assignment.ts`: plain interface `ShiftAssignment { employeeId: string; companyId:
string; shiftId: ShiftId; effectiveFrom: string; assignedAt: Date; assignedBy: string }`
       (like `device-user.ts`, no behaviour).
     - `shift-assignment.repository.ts`: `put(assignment): Promise<void>` — insert, or replace
       `shiftId`/`assignedAt`/`assignedBy` of the row with the same `employeeId` +
       `effectiveFrom`.
     - `errors.ts`, following its existing classes: `ShiftNotFoundError` (NotFoundError,
       `SHIFT_NOT_FOUND`, `'El turno no existe'`, `{ shiftId }`); `ShiftAlreadyExistsError`
       (ConflictError, `SHIFT_ALREADY_EXISTS`, `'Ya existe un turno con ese nombre en la empresa'`,
       `{ name }`); `CompanyNotFoundError` (NotFoundError, `COMPANY_NOT_FOUND`,
       `'La empresa no existe'`, `{ companyId }`); `EmployeeNotFoundError` (NotFoundError,
       `EMPLOYEE_NOT_FOUND`, `'El colaborador no existe'`, `{ employeeId }`);
       `EmployeeInactiveError` (BusinessRuleViolationError, `EMPLOYEE_INACTIVE`,
       `'El colaborador está desvinculado'`, `{ employeeId }`). Messages and detail keys must
       equal the catalog examples (`packages/contracts/src/errors.ts:139-149,201-213,426-441`).
   - Observable result: `pnpm typecheck` passes for `apps/api`.

4. **Application: ports, commands and queries**
   - Files: `apps/api/src/modules/attendance/application/ports/shift-company-directory.ts` (create), `apps/api/src/modules/attendance/application/ports/shift-employee-directory.ts` (create), `apps/api/src/modules/attendance/application/queries/shift.queries.ts` (create), `apps/api/src/modules/attendance/application/commands/create-shift.command.ts` (create), `apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.ts` (create), `apps/api/src/modules/attendance/application/queries/list-shifts.query.ts` (create), `apps/api/src/modules/attendance/application/queries/list-employee-shift-assignments.query.ts` (create)
   - Do:
     - Ports, shaped like `application/ports/site-directory.ts:1-13`:
       `ShiftCompanyDirectory { exists(companyId: string): Promise<boolean> }` and
       `ShiftEmployeeDirectory { find(employeeId: string): Promise<{ id: string; companyId:
string; active: boolean } | null> }`.
     - `ShiftQueries`: `listShifts(companyId, page: PageQuery): Promise<Page<ShiftDto>>` ordered
       by name, id; `listAssignments(employeeId, page): Promise<Page<ShiftAssignmentDto>>`
       ordered by `effectiveFrom` desc.
     - `CreateShift` (deps `shiftRepository`, `shiftCompanyDirectory`, `idGenerator`, `clock`):
       company missing → `CompanyNotFoundError`; `Shift.create`; `shiftRepository.add`; returns
       `{ id }`.
     - `AssignEmployeeShift` (deps `shiftRepository`, `shiftAssignmentRepository`,
       `shiftEmployeeDirectory`, `clock`), input `{ companyId, employeeId, effectiveFrom,
shiftId, assignedBy }`: employee missing or of another company → `EmployeeNotFoundError`
       (as `terminate-employee.command.ts:34-38`); not active → `EmployeeInactiveError`; shift
       missing or `shift.companyId !== companyId` → `ShiftNotFoundError`; then `put` with
       `assignedAt: clock.now()`. Returns `ok(undefined)`.
     - `ListShifts`: plain query (no Result), `shiftQueries.listShifts(companyId, page)`.
     - `ListEmployeeShiftAssignments`: like `list-device-commands.query.ts:12-29` — employee
       missing or of another company → `err(EmployeeNotFoundError)`, else
       `ok(shiftQueries.listAssignments(...))`.
   - Observable result: `pnpm typecheck` passes.

5. **Persistence: schema, migration, mapper and Prisma adapters**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261014184751_create_shifts/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/shift.mapper.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift-assignment.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift.queries.ts` (create)
   - Do: follow the `db-change` skill. After `AttendancePunch` add:
     - `AttendanceShift` → `@@map("shifts")`, `@@schema("attendance")`: `id` uuid; `companyId`
       uuid with the "referencia por id a organization, sin FK (ADR 0010)" doc comment;
       `name` VarChar(100); `nameKey` VarChar(100); `cycleStartDate` `@db.Date`;
       `toleranceMinutes` Int; `days` Json (doc comment: "Ciclo del turno: días WORK/REST, ver
       `domain/shift.ts`"); `active` Boolean default true; `createdAt` Timestamptz(3);
       `assignments AttendanceShiftAssignment[]`; `@@unique([companyId, nameKey])`.
     - `AttendanceShiftAssignment` → `@@map("shift_assignments")`: `employeeId` uuid (sin FK,
       ADR 0010 comment); `companyId` uuid (same comment); `shiftId` uuid with relation to
       `AttendanceShift` ("Mismo módulo: la FK está permitida", as `schema.prisma:297-299`);
       `effectiveFrom` `@db.Date`; `assignedAt` Timestamptz(3); `assignedBy` uuid;
       `@@id([employeeId, effectiveFrom])`; `@@index([shiftId])`.
     - Run `pnpm db:migrate --name create_shifts` (never edit an existing migration).
     - `shift.mapper.ts`: `ShiftMapper.toDomain(row)` (dates `YYYY-MM-DD` via
       `toISOString().slice(0, 10)`; `days` cast from Json after a shape check that throws on
       anything unexpected — the column is written only by this app), `toPersistence(shift)`
       (`cycleStartDate` as `new Date(\`${date}T00:00:00Z\`)`), `toDto(row)`, and
`ShiftAssignmentMapper.toDto(row & { shift: { name } })`.
     - `PrismaShiftRepository`: `findById`; `add` catching `isUniqueViolation` →
       `ShiftAlreadyExistsError` (as `prisma-device.repository.ts:35-47`).
     - `PrismaShiftAssignmentRepository.put`: `upsert` on `employeeId_effectiveFrom`.
     - `PrismaShiftQueries`: `listShifts` (`where: { companyId }`, `orderBy: [{ name: 'asc' },
{ id: 'asc' }]`, count) and `listAssignments` (`include: { shift: { select: { name:
true } } }`, `orderBy: { effectiveFrom: 'desc' }`, count), paginated like
       `prisma-attendance.queries.ts:61-76`.
   - Observable result: `pnpm db:migrate` applies; `pnpm db:generate` and `pnpm typecheck` pass.

6. **Cross-module adapters, in-memory adapters, HTTP and DI**
   - Files: `apps/api/src/modules/attendance/infrastructure/organization-shift-company-directory.ts` (create), `apps/api/src/modules/attendance/infrastructure/employees-shift-employee-directory.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-shift.store.ts` (create), `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/tests/test-app.ts` (modify), `apps/api/tests/error-catalog.test.ts` (modify)
   - Do:
     - `OrganizationShiftCompanyDirectory` (`organizationApi.findCompany(id) !== null`) and
       `EmployeesShiftEmployeeDirectory` (`employeesApi.findEmployee` → `{ id, companyId, active }`),
       shaped like `organization-site-directory.ts:1-13`.
     - `in-memory-shift.store.ts`: `InMemoryShiftStore` (maps of shifts and assignments keyed
       `employeeId|effectiveFrom`), `InMemoryShiftRepository`, `InMemoryShiftAssignmentRepository`
       and `InMemoryShiftQueries` honouring the same contracts as Prisma (copies on read,
       duplicate name → err, same orderings), like `in-memory-attendance.store.ts:106-182`.
     - Router: bind the 4 routes as `attendance.router.ts:33-84` does; `assignEmployeeShift`
       passes `{ ...params, shiftId: body.shiftId, assignedBy: requireActor(ctx).userId }`;
       `createShift` passes `{ ...body, companyId: params.companyId }`.
     - Module: add to `AttendanceCradle` and `registrations` (`attendance.module.ts:45-104`)
       `shiftRepository`, `shiftAssignmentRepository`, `shiftQueries`,
       `shiftCompanyDirectory`, `shiftEmployeeDirectory`, `createShift`,
       `assignEmployeeShift`, `listShifts`, `listEmployeeShiftAssignments`.
     - `test-app.ts`: create one `InMemoryShiftStore` next to `test-app.ts:63` and register
       `shiftRepository`, `shiftAssignmentRepository`, `shiftQueries` with `asValue` next to
       `test-app.ts:160-164`.
     - `error-catalog.test.ts:34-38`: add `'attendance/EmployeeInactiveError': 'employees'` to
       `VARIANT_BY_CLASS` (mechanical; the new class answers the `employees` variant body).
   - Observable result: `pnpm check` passes, including `tests/container.test.ts`,
     `tests/error-catalog.test.ts` and `pnpm arch:check`.

7. **Docs**
   - Files: `docs/harness/modules.json` (modify)
   - Do: in the `attendance` summary, after "Punches attributed by RFC.", add "Shifts per company
     (cyclic pattern) assigned to colaboradores by date."
   - Observable result: `pnpm plans:lint` and `pnpm harness:check` (part of `pnpm check`) pass.

8. **Tests phase files, Deviation 2 file and doc** (added after review Low-1 and Low-4)
   - Files: `apps/api/src/modules/attendance/domain/shift.test.ts` (create), `apps/api/src/modules/attendance/application/commands/create-shift.command.test.ts` (create), `apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.test.ts` (create), `apps/api/src/modules/attendance/application/queries/list-employee-shift-assignments.query.test.ts` (create), `apps/api/tests/attendance-shifts.test.ts` (create), `apps/api/tests/integration/attendance/prisma-shift.int.test.ts` (create), `packages/contracts/src/attendance/shift.contract.test.ts` (create), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `docs/architecture.md` (modify)
   - Do: the tester's files (see Test coverage); the grant-count assertions of Deviation 2; the
     attendance legend in the architecture overview.
   - Observable result: `pnpm plans:scope … --base origin/main` lists no file of this plan out of
     scope.

## Acceptance criteria

- [ ] `POST /api/v1/companies/:companyId/attendance/shifts` as HR of that company with a Mon–Fri
      09:00–18:00 shift (7 days, 60 min meal, `cycleStartDate` a Monday, tolerance 10) → 201 with
      `id`; the same name in other casing → 409 `SHIFT_ALREADY_EXISTS`; the same name in another
      company → 201.
- [ ] A night shift (`start` 22:00, `end` 06:00) and a 24x24 shift (2 days: WORK 08:00–08:00,
      REST) are accepted; a cycle with only REST days, 29 days, a meal ≥ the day's duration or
      `start` "24:00" → 400 `VALIDATION_ERROR`.
- [ ] Creating a shift for a company id that does not exist, as HOLDING_ADMIN → 404
      `COMPANY_NOT_FOUND`. HR of company A calling any of the 4 routes for company B → 403.
- [ ] `GET …/attendance/shifts` lists only that company's shifts, ordered by name, with `days`
      exactly as sent (meal break defaulted to 0 when omitted).
- [ ] `PUT …/attendance/employees/:employeeId/shift-assignments/2026-11-02` with a shift of the
      same company → 204; repeating it with another shift → 204 and the history shows one row for
      that date with the new shift; a second date adds a row; the list is newest date first with
      `shiftName`, `assignedAt` and `assignedBy` = the caller's user id.
- [ ] Assigning a colaborador of another company → 404 `EMPLOYEE_NOT_FOUND`; a shift of another
      company → 404 `SHIFT_NOT_FOUND`; a terminated colaborador → 422 `EMPLOYEE_INACTIVE`;
      listing assignments of a colaborador of another company → 404 `EMPLOYEE_NOT_FOUND`.
- [ ] Rows exist in `attendance.shifts` and `attendance.shift_assignments`; `days` is JSONB.
- [ ] `pnpm check` and `pnpm test:integration` pass; `/docs` shows the 4 operations.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                        |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `Shift.create` rules (empty/oversized cycle, no WORK day, bad time, meal ≥ duration, tolerance range, name trim/key); `dayOn` for 7-day, 2-day and 14-day cycles, dates before `cycleStartDate`; `workMinutes` for day, night and 24 h days. |
| application | yes     | `CreateShift` (company missing, duplicate); `AssignEmployeeShift` (each error, replace on same date, `assignedAt` from the clock); `ListEmployeeShiftAssignments` 404.                                                                       |
| contract    | yes     | `CreateShiftSchema` refinements and defaults; route access and error declarations.                                                                                                                                                           |
| http        | yes     | The 4 routes on the real container: status codes, company scoping (403 / 404), replace semantics, ordering.                                                                                                                                  |
| integration | yes     | Prisma adapters against `rrhh_test`: unique `(companyId, nameKey)` race → err, JSONB round trip, upsert by `(employeeId, effectiveFrom)`, query ordering and pagination.                                                                     |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                                  |

## Deviations

Cosmetic, fixed forward (no design or scope impact):

1. **Step 2, day schema split.** `ShiftDaySchema` with `.default(0)` on `mealBreakMinutes` and one
   `.meta({ id })` made OpenAPI fail ("el modelo tiene dos formas distintas": input optional vs
   output required). Split into `ShiftDayInputSchema` (id `CreateAttendanceShiftDayInput`, default
   0, used by `CreateShiftSchema.days`) and `ShiftDaySchema` (id `AttendanceShiftDay`, required,
   used by `ShiftSchema`). Wire behaviour is what the plan describes.
2. **Step 1, expected counts outside the listed files.** Adding two HR permissions raised HR's grant
   count; mechanical `toHaveLength` updates (10 to 12, 20 to 24) in `role-catalog.test.ts` (listed)
   and in `apps/api/src/modules/identity/application/session-authenticator.test.ts` (NOT listed;
   two assertions, 10 to 12).
3. **Step 4, lint.** `@typescript-eslint/prefer-optional-chain` required `employee?.companyId !==
companyId` / `shift?.companyId !== companyId` instead of `!x || x.companyId !== ...`; same
   behaviour.

Process note: `pnpm plans:scope` reports many out-of-scope files from earlier work on this branch
(employees-desvinculacion); the only out-of-scope file touched by this implementation is the
`session-authenticator.test.ts` of deviation 2.

Commands: `pnpm check` green; `pnpm test:integration` 229/229 green (no new integration tests yet:
tester phase). Migration `20261014184751_create_shifts` applied to the dev DB.

## Test coverage

Baseline (`pnpm check`, before tests): green. No GAP and no NOT CONFIRMED: every plan promise found
in the code behaved as described. Counts: domain 31, application 16, contract 33, http 29,
integration 13 (122 tests, all new).

| Behavior                                                                           | Source                                            | Layer       | Test                                                    | State     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------- | ----------- | ------------------------------------------------------- | --------- |
| Name trimmed, `nameKey` lowercase, active, no events                               | `shift.ts` `Shift.create`                         | domain      | `shift.test.ts › Shift.create`                          | CONFIRMED |
| Rejects empty/oversized name, bad date, tolerance, cycle 0/29, no WORK, bad time   | `shift.ts` `validateDays`, `create`               | domain      | `shift.test.ts › rechaza %s con INVALID_VALUE`          | CONFIRMED |
| Meal break < duration (day, night); accepts 59 of 60                               | `shift.ts` `grossMinutes`                         | domain      | `shift.test.ts`                                         | CONFIRMED |
| `dayOn` for 7/2/14-day cycles, dates before `cycleStartDate`                       | `shift.ts` `dayOn`                                | domain      | `shift.test.ts › Shift.dayOn`                           | CONFIRMED |
| `workMinutes` day, night, 24 h                                                     | `shift.ts` `workMinutes`                          | domain      | `shift.test.ts › workMinutes`                           | CONFIRMED |
| `CreateShift`: persists, company missing, duplicate, other company, invalid cycle  | `create-shift.command.ts`                         | application | `create-shift.command.test.ts`                          | CONFIRMED |
| `AssignEmployeeShift`: each error, replace, history order, `assignedAt` from clock | `assign-employee-shift.command.ts`                | application | `assign-employee-shift.command.test.ts`                 | CONFIRMED |
| `ListEmployeeShiftAssignments` 404 (missing / other company), empty page           | `list-employee-shift-assignments.query.ts`        | application | `list-employee-shift-assignments.query.test.ts`         | CONFIRMED |
| `CreateShiftSchema` refinements, defaults, ranges; read schema; route access       | `shift.contract.ts`                               | contract    | `shift.contract.test.ts`                                | CONFIRMED |
| 4 routes: 201/204/200, 400, 401, 403 other-company HR, 404, 409, 422, pagination   | `attendance.router.ts`, `shift.contract.ts`       | http        | `tests/attendance-shifts.test.ts`                       | CONFIRMED |
| Unique `(companyId, nameKey)` incl. concurrent race, JSONB round trip              | `prisma-shift.repository.ts`, `schema.prisma:315` | integration | `tests/integration/attendance/prisma-shift.int.test.ts` | CONFIRMED |
| Upsert by `(employeeId, effectiveFrom)`; query ordering and pagination             | `prisma-shift-assignment.repository.ts`, queries  | integration | `tests/integration/attendance/prisma-shift.int.test.ts` | CONFIRMED |

Notes: `assignedBy` in http is asserted as a uuid (the caller's id is not exposed by the test
helper); the exact equality is covered in the application test. Empty `days` yields two issues, both
on `days` (min length and no WORK day), asserted as such.

## Review findings

Reviewed 2026-10-14 (reviewer subagent). Diff `origin/main...HEAD` on
`feat/attendance-asistencia-diaria` (commits `56cf543`, `f587712`, `30352a5`; `d691308` belongs to
employees-desvinculacion and was not reviewed), clean worktree.

**Checklist: 11/13 passed. Failed: scope and stale docs.**

- [ ] `pnpm plans:scope … --base origin/main` **fails**. Out of scope: the 8 test files the
      tester created (`shift.test.ts`, `create-shift.command.test.ts`,
      `assign-employee-shift.command.test.ts`, `list-employee-shift-assignments.query.test.ts`,
      `tests/attendance-shifts.test.ts`, `tests/integration/attendance/prisma-shift.int.test.ts`,
      `shift.contract.test.ts`) and `identity/application/session-authenticator.test.ts`
      (Deviation 2). `plans/employees-desvinculacion/README.md` comes from `d691308`, not this
      plan. Declared but unchanged: the placeholder path
      `migrations/<timestamp>_create_shifts/migration.sql` (the real one is
      `20261014184751_create_shifts`). See Low-1. Hot files are append-only: `schema.prisma`
      adds two models at the end, `test-app.ts` adds an import, a store and three `asValue`
      lines, `contracts/src/index.ts` adds an export, an import and one `apiRoutes` key, and
      `modules.json` changes only the attendance summary sentence that step 7 asked for.
- [x] `pnpm check` green (19/19 turbo tasks, arch, plans, harness, hooks, bootstrap, quality).
- [x] `pnpm test:integration`: 18 files and 242 tests passed against `rrhh_test`.
- [x] Business rules are in `domain/shift.ts` (cycle, times, meal < duration, tolerance, name
      key). Routers, mappers and adapters contain none. The contract repeats the rules as input
      validation, as the plan asked.
- [x] CQRS-lite holds. `CreateShift` goes aggregate → `ShiftRepository.add` → `Result`, and
      `AssignEmployeeShift` → `ShiftAssignmentRepository.put`. Reads go through `ShiftQueries` →
      contract DTOs. Neither repository has a screen method.
- [x] Request/response types come from `@rrhh/contracts`. `openapi.json` was regenerated and
      `openapi.test.ts` expects 36 operations.
- [x] Errors: five new domain errors with stable codes. Their messages and detail keys match the
      catalog examples. `error-catalog.test.ts` maps `attendance/EmployeeInactiveError` to the
      `employees` variant.
- [x] No money involved. Dates are `@db.Date` written as UTC midnight and read back with
      `toISOString().slice(0, 10)`. Ids come from `IdGenerator`, and `createdAt`/`assignedAt`
      come from `Clock`.
- [x] New migration `20261014184751_create_shifts`: two `CREATE TABLE`, one unique index, one
      index, and one FK `shift_assignments.shift_id → shifts.id` inside the same `attendance`
      schema. No DROP. No FK to `organization` or `employees`; those are referenced by id only,
      with the ADR 0010 comment.
- [x] DI: nine registrations in `attendance.module.ts`, made once. `container.test.ts` is green.
- [x] No secrets, `.env` contents or real personal data. Fixtures use synthetic uuids and
      shift names.
- [x] `## Deviations` is honest. I checked Deviation 1: `shift.contract.ts:44-62` has
      `ShiftDayInputSchema` (`CreateAttendanceShiftDayInput`, with a default of 0) and
      `ShiftDaySchema` (`AttendanceShiftDay`, required). Deviation 3 is visible at
      `assign-employee-shift.command.ts:41,47`.
- [ ] Stale docs. See Low-4.

**Findings: 0 Critical, 0 High, 0 Medium, 4 Low.**

- **Low-1: tester files and the Deviation 2 file are not declared in any `Files:` line.**
  - These are the 8 files listed in the first checklist item. All of them are legitimate. The
    test files appear in `## Test coverage`, and `session-authenticator.test.ts` appears in
    Deviation 2.
  - Failure scenario: `plans:scope` stays red for this plan, so it cannot be used as a gate at
    commit or PR time. This is the same as Low-1 in the employees-desvinculacion reviews.
  - Fix (plan only, no code): add a "tests phase" step with these paths in its `Files:` line.
    Optionally, replace `<timestamp>` in step 5 with `20261014184751`.
- **Low-2: the in-memory `listShifts` sorts names by UTF-16 code unit, but Postgres uses its
  collation.**
  - Location: `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-shift.store.ts:39-41,79`.
  - The plan requires in-memory adapters to honour "the same orderings" as Prisma.
    `PrismaShiftQueries` orders by `name asc` with the database collation (the dev image uses a
    linguistic locale; **uncertain**: I did not query `datcollate`). The in-memory sort uses
    `<`/`>`. The existing `in-memory-site.store.ts:47` uses `localeCompare` for the same
    `orderBy: [{ name: 'asc' }, { id: 'asc' }]`.
  - Failure scenario: with shifts "nocturno" and "Matutino Beta" plus "alfa", the HTTP test
    container returns `["Matutino Beta", "alfa", "nocturno"]` (uppercase first), while Postgres
    returns `["alfa", "Matutino Beta", "nocturno"]`. An HTTP test that asserts mixed-case order
    would pass in memory and contradict production. Current tests use names with consistent
    capitalization, so none fail today.
  - Fix: use `localeCompare` as the site store does. Product-adjacent test adapter; small.
- **Low-3: `SHIFT_DAY_TYPES`/`ShiftDayType` (step 1) are exported but never used, and the
  duration formula exists twice.**
  - Location: `packages/domain/src/attendance/shift-rules.ts:6-7` has no importers.
    `domain/shift.ts:17-18` and `shift.mapper.ts:21-24` use string literals.
    `durationMinutes` (`shift.contract.ts:13-24`) and `grossMinutes` (`domain/shift.ts:35-48`)
    are two copies of the same rule.
  - Failure scenario: a later change to the night/24-hour rule (for example, `end = start`
    stops meaning 24 h) gets updated in one copy only. Then the contract accepts a cycle that
    `Shift.create` rejects. That error is an `INVALID_VALUE` not declared on `createShift`.
    It is not a bug today because the two copies are identical.
  - Fix (optional, cosmetic): type `ShiftDay.type` from `ShiftDayType`, and move the duration
    helper into `shift-rules.ts` so both layers import it. The README already allows shared
    pure vocabulary under ADR 0007.
- **Low-4: `docs/architecture.md:23` still says attendance is "† = solo marcaciones crudas
  ZKTeco".**
  - This was already stale before this plan (attribution and device sync came from earlier
    series). With shifts it is further from the truth.
  - Failure scenario: a reader of the architecture overview thinks attendance has no
    business model beyond raw punches, and looks for shifts somewhere else.
  - Fix: update the legend (for example "† = marcaciones, checadores y turnos; jornadas por
    construir") and declare `docs/architecture.md` in the plan. You can instead record it as a
    finding in `plans/hallazgos/`, since the staleness predates this plan.

Bug hunt (correctness). I traced the four routes from the contract through the use case, the
domain, both adapters and the response. **No defects found.**

- Tenancy. All four routes require `companyParam: 'companyId'`, so HR of company B gets 403.
  Within the route's company, a colaborador or shift of another company returns 404
  (`assign-employee-shift.command.ts:41-49`, `list-employee-shift-assignments.query.ts:23-26`).
  `listShifts` filters by `companyId`. Colaboradores cannot change company (`employee.ts` has no
  company setter), so `listAssignments` filtering only by `employeeId` cannot leak another
  company's rows.
- Check order. Employee missing → inactive → shift: an inactive colaborador of another
  company gets 404, not 422, so its state is not revealed.
- Dates. `z.iso.date()` rejects impossible dates such as `2026-02-30`. `effectiveFrom` and
  `cycleStartDate` are stored as UTC midnight `DATE` and read back unchanged. `dayOn` uses
  `Date.UTC` and `Math.round`, so DST cannot shift the index, and the double modulo handles
  dates before `cycleStartDate`.
- Night and 24-hour days. `end ≤ start` adds 1440, so 22:00–06:00 is 480 minutes and
  08:00–08:00 is 1440. Meal ≥ duration is rejected in both the contract and the domain.
- Concurrency. Two concurrent creates with the same name: the unique `(company_id, name_key)`
  index decides, and the loser gets `SHIFT_ALREADY_EXISTS` (integration test with `Promise.all`).
  Two concurrent `PUT`s for the same date: the `upsert` keys on the compound primary key, so
  the last write wins and the PUT stays idempotent. I believe Prisma issues a native
  `ON CONFLICT` here, so a P2002 is unlikely; this part is **uncertain** and not covered by a
  concurrent test.
- Edge (not reported as a finding): `nameKey = name.toLowerCase()` can be longer than `name` for
  a few code points (for example `İ`). A 100-character name containing one would overflow
  `name_key VARCHAR(100)` and produce a 500. The sedes `nameKey` pattern has the same property.
  This is very unlikely with real shift names.

The status stays `review`. Low-2 is a small change to a test adapter. Low-1 and Low-4 are
plan/doc edits, and Low-3 is optional. After a repair to `in-memory-shift.store.ts`, the repair
handoff applies: testing → review → verify. After plan/doc-only edits, no new testing round is
needed. The main session decides the routing.

**Resolution (main session, 2026-10-14):** Low-1 → step 8 declares the 7 test files and
`session-authenticator.test.ts`; step 5 names the real migration. Low-2 →
`in-memory-shift.store.ts` sorts names with `localeCompare` (as `in-memory-site.store.ts`). It is
an in-memory test adapter, not a runtime path, so it was handled as a test-only correction: no
existing test asserts mixed-case order and `pnpm check` is green after the change. Low-3 →
accepted as is; plan 002 decides whether jornada code shares the duration helper. Low-4 →
`docs/architecture.md` legend updated, declared in step 8. `pnpm plans:scope --base origin/main`
now lists only `plans/employees-desvinculacion/README.md` (commit `d691308`, the closure of
another series on this branch). Plan to `verify`.

## Verification
