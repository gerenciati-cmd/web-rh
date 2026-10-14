---
status: draft
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
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/<timestamp>_create_shifts/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/shift.mapper.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift-assignment.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift.queries.ts` (create)
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

## Test coverage

## Review findings

## Verification
