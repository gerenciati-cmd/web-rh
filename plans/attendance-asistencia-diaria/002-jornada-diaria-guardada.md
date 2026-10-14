---
status: testing
module: attendance
min_implementer: high
depends_on: ['001', 'employees-fechas-laborales/001']
---

# 002 — Stored daily jornada

## Context

**Today.** Plan 001 (`done`) stores company shifts as a cycle and a per-colaborador assignment
history. `Shift.dayOn(date)` resolves the cycle day of a date and `workMinutes(day)` gives a WORK
day's minutes minus the meal (`apps/api/src/modules/attendance/domain/shift.ts:44-53,187-198`).
Assignments can only be written (`apps/api/src/modules/attendance/domain/shift-assignment.repository.ts:3-9`).
Punches are stored per device with their UTC instant (`apps/api/prisma/schema.prisma`
`AttendancePunch`; `apps/api/src/modules/attendance/domain/punch.ts:15-25`) and the punch
repository only writes (`apps/api/src/modules/attendance/domain/punch.repository.ts:3-9`). The
PIN is the colaborador's RFC (`apps/api/src/modules/attendance/application/ports/punch-owner-directory.ts:1-5`).
A sede's time zone is read through the attendance `SiteDirectory` port
(`apps/api/src/modules/attendance/application/ports/site-directory.ts:5-13`, registered as
`deviceSiteDirectory`). Local wall time → UTC is `localDateTimeToUtc`
(`packages/domain/src/time-zone.ts:46-74`). Repositories run several writes atomically with
`database.inTransaction` (`apps/api/src/infrastructure/database/prisma-database.ts:29-33`).
There is no scheduled/recurring job anywhere (`apps/api/src/main/worker.ts:19-33` only runs
enqueued jobs), which is why automatic recalculation is plan 003 (README decision 19).

**Need.** README decisions 4–7, 10 and 14–18: build each day's jornada from the shift and the
punches, store it, recalculate it on demand for a colaborador and a date range, and read it.

**Approach.** A pure domain calculator turns (calendar of planned days, time zone, punch
instants, now) into workday rows; the command loads the inputs through ports and replaces the
stored rows of the recalculated dates in one transaction. Compared with (a) computing on read
(discarded by decision 10) and (b) recalculating per punch as it arrives (needs the triggers of
plan 003 and still a full-range recompute for faltas), an explicit "recalculate range" command is
the smallest piece that 003 can later call from its triggers and its daily close.

**The punch window (decision 17, the architect's theoretical rule).** `M` =
`PUNCH_WINDOW_MARGIN_MINUTES` = 240. For consecutive dates, each date's window starts at a
boundary `b(D)` and ends at `b(D+1)`, so windows never overlap and cover all time:

- WORK day: `b(D) = start(D) − M`. If D−1 is a WORK day and `end(D−1) > b(D)`, then
  `b(D) = start(D)` when `end(D−1) ≥ start(D)`, else the midpoint of `end(D−1)` and `start(D)`.
- REST or unassigned day: `b(D) = local midnight of D`; if D−1 is a WORK day,
  `b(D) = max(b(D), end(D−1) + M)` (the exit of a night or 24 h shift stays with its day).
- Boundaries are made non-decreasing: `b(D) = max(b(D), b(D−1))`.

`start(D)` is D's `start` in the sede's time zone; `end(D)` is `end` on D, or on D+1 when
`end ≤ start` (plan 001 rule). Examples: a 09:00–18:00 day captures 05:00 to 05:00 of the next
WORK day; a 22:00–06:00 night shift captures 18:00 D to 18:00 D+1 (next WORK at 22:00), or to
10:00 D+1 if D+1 is a rest day.

**Day rules.** First punch in the window = entry, last = exit (decision 4). WORK day: 0 punches →
`ABSENT_NO_PUNCHES`; 1 → `ABSENT_SINGLE_PUNCH` (decision 7); ≥ 2 → `ATTENDED` with
`late = floor((entry − start) / 1 min)`, `lateMinutes = late > tolerance ? late : 0` (decisions 6
and 15), `workedMinutes = max(0, floor((exit − entry) / 1 min) − mealBreakMinutes)` (decision
5), `overtimeMinutes = max(0, worked − workMinutes(day))` (decision 14: arriving early counts).
REST day with ≥ 1 punch → `REST_WORKED`, worked = `floor((exit − entry) / 1 min)` (0 with one
punch), overtime = worked (decision 16). REST day without punches and unassigned days → no row.
Only dates between hire and termination (inclusive) get rows (decision 18), and only **closed**
dates (`b(D+1) ≤ now`) are calculated; open dates are reported as pending.

**Imitated files.** Command and 404 rule: `apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.ts`
(plan 001). Query with 404: `apps/api/src/modules/attendance/application/queries/list-employee-shift-assignments.query.ts`.
Contract: `packages/contracts/src/attendance/shift.contract.ts:142-211`. Cross-module adapter:
`apps/api/src/modules/attendance/infrastructure/employees-shift-employee-directory.ts:1-18`.
Mapper with date-only columns: `apps/api/src/modules/attendance/infrastructure/shift.mapper.ts:40-42`.
In-memory adapters: `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-shift.store.ts`.

**Known limitations (accepted).** Punches are matched by the colaborador's **current** RFC, so
punches made under an earlier RFC are not counted. The **current** sede's time zone is used for
the whole range.

## Out of scope

- Automatic recalculation: on new punches, on assignment changes, the daily close, a scheduled
  job and its ADR (plan 003). Company-wide or bulk recalculation (plan 003).
- The N-retardos = falta rule (plan 004).
- Holidays (feriados, LFT art. 74), justified absences, permits and incapacities (leave module),
  manual punch corrections, overtime authorization and pay, period closing/locking.
- Making the window margin configurable; per-date time-zone history; re-attributing punches of
  an old RFC.
- Web and mobile screens.

## Dependencies

- `001` (done): `Shift`, `Shift.dayOn`, `workMinutes`, `ShiftRepository.findById`,
  `ShiftAssignmentRepository`, `attendance.shift_assignments`.
- `employees-fechas-laborales/001`: `EmployeeSummary.hireDate: string` (`YYYY-MM-DD`) and
  `EmployeeSummary.terminationDate: string | null`, returned by `EmployeesApi.findEmployee`.

## Steps

1. **Shared vocabulary: permissions, statuses and limits**
   - Files: `packages/domain/src/identity/access.ts` (modify), `packages/domain/src/attendance/workday-rules.ts` (create), `packages/domain/src/index.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify)
   - Do: add `'attendance.workdays:read'` and `'attendance.workdays:recalculate'` after
     `'attendance.shifts:manage'` (`access.ts:19`) and to HR after `role-catalog.ts:32`, with a
     comment citing decision 11. `workday-rules.ts` (docblock citing decisions 7, 14–17):
     `WORKDAY_STATUSES = ['ATTENDED', 'ABSENT_NO_PUNCHES', 'ABSENT_SINGLE_PUNCH', 'REST_WORKED'] as const`
     and `WorkdayStatus`; `PUNCH_WINDOW_MARGIN_MINUTES = 240`;
     `MAX_WORKDAY_RANGE_DAYS = 62`. Export it from `index.ts` next to `attendance/shift-rules`.
     Update the expected HR list and the HR/HOLDING_ADMIN grant counts in `role-catalog.test.ts`
     and the grant counts in `session-authenticator.test.ts` (mechanical, +2 each, as plan 001
     Deviation 2 did).
   - Observable result: both tests pass.

2. **Contract: workdays**
   - Files: `packages/contracts/src/attendance/workday.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/src/errors.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do, following `shift.contract.ts`:
     - `WorkdayRangeSchema`: `from`, `to` (`z.iso.date()`); `.refine` `from ≤ to` (path `['to']`,
       "La fecha final no puede ser anterior a la inicial") and span ≤ `MAX_WORKDAY_RANGE_DAYS`
       days inclusive (path `['to']`, "El rango no puede pasar de 62 días"). Use it as the body
       of the recalculation (`.meta({ id: 'RecalculateAttendanceWorkdaysInput' })`) and as the
       query of the list (without `meta`).
     - `WorkdaySchema` (`.meta({ id: 'AttendanceWorkday' })`): `date` (iso date), `shiftId`
       (uuid), `shiftName`, `status` (`z.enum(WORKDAY_STATUSES)`), `scheduledStartAt`,
       `scheduledEndAt` (`z.iso.datetime().nullable()`, null on REST_WORKED),
       `scheduledMinutes` (int), `firstPunchAt`, `lastPunchAt` (`z.iso.datetime().nullable()`),
       `punchCount`, `lateMinutes`, `workedMinutes`, `overtimeMinutes` (int ≥ 0),
       `calculatedAt` (datetime). Describe each status in Spanish.
     - `WorkdayRecalculationSchema` (`.meta({ id: 'AttendanceWorkdayRecalculation' })`):
       `recalculatedDates` (int: closed dates processed), `storedWorkdays` (int),
       `pendingDates` (array of iso dates still open, not calculated).
     - `attendanceWorkdayRoutes`:
       - `recalculateEmployeeWorkdays`: `POST /companies/:companyId/attendance/employees/:employeeId/workdays/recalculation`,
         body range, response `WorkdayRecalculationSchema`, 200, errors
         `['EMPLOYEE_NOT_FOUND', 'SITE_NOT_FOUND', 'EMPLOYEE_WITHOUT_RFC', 'EMPLOYEE_WITHOUT_SITE', { code: 'EMPLOYEE_INACTIVE', variant: 'employees' }]`,
         `requires('attendance.workdays:recalculate', { companyParam: 'companyId' })`. Description:
         replaces the stored jornadas of the closed dates; works for terminated colaboradores too.
       - `listEmployeeWorkdays`: `GET /companies/:companyId/attendance/employees/:employeeId/workdays`,
         query range, response `z.object({ items: z.array(WorkdaySchema) })`, errors
         `['EMPLOYEE_NOT_FOUND']`, `requires('attendance.workdays:read', { companyParam: 'companyId' })`.
         Dates ascending; dates without a row are absent.
     - `index.ts`: export the file and add `attendanceWorkdays: attendanceWorkdayRoutes`.
     - `errors.ts`, after `SHIFT_ALREADY_EXISTS`: `EMPLOYEE_WITHOUT_RFC` (422, message
       `'El colaborador no tiene RFC: sus marcaciones no se pueden atribuir'`, details
       `{ employeeId }`) and `EMPLOYEE_WITHOUT_SITE` (422, `'El colaborador no tiene sede asignada'`,
       `{ employeeId }`).
     - `openapi.test.ts`: `36` → `38`; regenerate `openapi.json`
       (`pnpm --filter @rrhh/contracts openapi`).
   - Observable result: `pnpm --filter @rrhh/contracts test` passes.

3. **Domain: dates, the window calculator and the workday**
   - Files: `apps/api/src/modules/attendance/domain/local-date.ts` (create), `apps/api/src/modules/attendance/domain/workday.ts` (create), `apps/api/src/modules/attendance/domain/workday-calculator.ts` (create), `apps/api/src/modules/attendance/domain/workday.repository.ts` (create), `apps/api/src/modules/attendance/domain/shift-assignment.repository.ts` (modify), `apps/api/src/modules/attendance/domain/punch.repository.ts` (modify), `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do:
     - `local-date.ts`: `addDays(date: string, days: number): string` and
       `daysBetween(from: string, to: string): number` on `YYYY-MM-DD` via `Date.UTC`;
       `localInstant(date: string, time: string, timeZone: string): Date` =
       `localDateTimeToUtc(\`${date} ${time}:00\`, timeZone)`, throwing on `err` (the zone comes
       from a validated sede: an error is unexpected).
     - `workday.ts`: plain interface `Workday` (`employeeId`, `companyId`, `date`, `shiftId`,
       `status: WorkdayStatus`, `scheduledStartAt: Date | null`, `scheduledEndAt: Date | null`,
       `scheduledMinutes`, `firstPunchAt: Date | null`, `lastPunchAt: Date | null`,
       `punchCount`, `lateMinutes`, `workedMinutes`, `overtimeMinutes`, `calculatedAt: Date`),
       like `shift-assignment.ts`.
     - `workday-calculator.ts`: `export interface PlannedDate { date: string; plan: { shiftId:
ShiftId; day: ShiftDay; toleranceMinutes: number } | null }` and
       `calculateWorkdays(input: { employeeId; companyId; calendar: readonly PlannedDate[];
timeZone; punches: readonly Date[]; employedFrom: string; employedUntil: string | null;
now: Date }): { workdays: Workday[]; closedDates: string[]; pendingDates: string[] }`.
       `calendar` holds consecutive dates from `from − 1` to `to + 1`; only `calendar[1..n]`
       (the requested dates) produce output. Also export `windowBoundaries(calendar, timeZone):
Date[]` (one boundary per calendar entry, the rules of Context "The punch window") so it
       can be tested alone. Apply "Day rules" of Context exactly; a closed date outside
       `[employedFrom, employedUntil]` or without a plan is in `closedDates` with no row.
       Docblock cites decisions 4–7 and 14–18 and gives the two examples of Context.
     - `workday.repository.ts`: `replaceDates(employeeId: string, dates: readonly string[],
workdays: readonly Workday[]): Promise<void>` — deletes the employee's rows on those dates
       and inserts `workdays` (all of whose dates are in `dates`) atomically.
     - `shift-assignment.repository.ts`: add `listByEmployee(employeeId): Promise<ShiftAssignment[]>`
       ordered by `effectiveFrom` ascending.
     - `punch.repository.ts`: add `listInstants(pin: string, from: Date, to: Date): Promise<Date[]>`
       — `occurredAt` of the PIN's punches with `from ≤ occurredAt < to`, ascending, from any device.
     - `errors.ts`: `EmployeeWithoutRfcError` (BusinessRuleViolationError, `EMPLOYEE_WITHOUT_RFC`)
       and `EmployeeWithoutSiteError` (`EMPLOYEE_WITHOUT_SITE`), messages and `{ employeeId }`
       equal to step 2.
   - Observable result: `pnpm typecheck` passes.

4. **Application: port, command and query**
   - Files: `apps/api/src/modules/attendance/application/ports/workday-employee-directory.ts` (create), `apps/api/src/modules/attendance/application/queries/workday.queries.ts` (create), `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts` (create), `apps/api/src/modules/attendance/application/queries/list-employee-workdays.query.ts` (create)
   - Do:
     - Port `WorkdayEmployeeDirectory.find(employeeId)` →
       `{ id, companyId, active: boolean, rfc: string | null, siteId: string | null, hireDate: string,
terminationDate: string | null } | null`.
     - `WorkdayQueries.listByEmployee(employeeId, from, to): Promise<WorkdayDto[]>` (date asc,
       with `shiftName`).
     - `RecalculateWorkdays` (deps `workdayEmployeeDirectory`, `deviceSiteDirectory`,
       `shiftAssignmentRepository`, `shiftRepository`, `punchRepository`, `workdayRepository`,
       `clock`), input `{ companyId, employeeId, from, to }`, in this order: employee missing or
       other company → `EmployeeNotFoundError`; `active` false with `terminationDate` null (a
       termination stored before the date field existed, finding
       `attendance-baja-sin-fecha-en-la-jornada`) → the existing `EmployeeInactiveError` of plan
       001, so no jornadas are built without an end; `rfc` null → `EmployeeWithoutRfcError`; `siteId`
       null → `EmployeeWithoutSiteError`; site missing → `SiteNotFoundError`; range invalid
       (`from > to` or > 62 days) → `InvalidValueError`. Build `calendar` for `from − 1 … to + 1`:
       per date the latest assignment with `effectiveFrom ≤ date`, its shift (load each distinct
       `shiftId` once with `findById`), `shift.dayOn(date)`, `shift.toleranceMinutes`. Compute
       boundaries, fetch `listInstants(rfc, boundaries[1], boundaries[last])`, call
       `calculateWorkdays`, then `workdayRepository.replaceDates(employeeId, closedDates,
workdays)`. Return `ok({ recalculatedDates: closedDates.length, storedWorkdays:
workdays.length, pendingDates })`.
     - `ListEmployeeWorkdays`: like `list-employee-shift-assignments.query.ts` — 404 for a
       missing/other-company employee (via `workdayEmployeeDirectory`), else
       `ok({ items: await workdayQueries.listByEmployee(...) })`.
   - Observable result: `pnpm typecheck` passes.

5. **Persistence: schema, migration, mapper, Prisma adapters**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261014205513_create_workdays/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/workday.mapper.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-workday.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-workday.queries.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-shift-assignment.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-punch.repository.ts` (modify)
   - Do: follow the `db-change` skill.
     - `AttendancePunch`: add `@@index([pin, occurredAt])`.
     - New `AttendanceWorkday` → `@@map("workdays")`, `@@schema("attendance")`: `employeeId`
       uuid (ADR 0010 comment), `companyId` uuid (same), `date` `@db.Date`, `shiftId` uuid with
       relation to `AttendanceShift` ("Mismo módulo: la FK está permitida"; add the back-relation
       `workdays AttendanceWorkday[]` on `AttendanceShift`), `status` VarChar(24),
       `scheduledStartAt`/`scheduledEndAt` Timestamptz(3)?, `scheduledMinutes` Int,
       `firstPunchAt`/`lastPunchAt` Timestamptz(3)?, `punchCount`, `lateMinutes`,
       `workedMinutes`, `overtimeMinutes` Int, `calculatedAt` Timestamptz(3);
       `@@id([employeeId, date])`, `@@index([companyId, date])`, `@@index([shiftId])`.
     - `pnpm db:migrate --name create_workdays`; after it runs, replace `<timestamp>` in this
       step's `Files:` line with the real folder name (bookkeeping, not a deviation).
     - `workday.mapper.ts`: `toPersistence(workday)` (date as `new Date(\`${date}T00:00:00Z\`)`)
and `toDto(row & { shift: { name } })`(dates via`toISOString().slice(0, 10)`, instants
via `toISOString()`, status checked against `WORKDAY_STATUSES`, throwing on an unknown
value as `shift.mapper.ts:14-37` does).
     - `PrismaWorkdayRepository.replaceDates`: inside `database.inTransaction`, `deleteMany`
       `{ employeeId, date: { in: dates } }` then `createMany` (skip when empty).
     - `PrismaWorkdayQueries.listByEmployee`: `where { employeeId, date: { gte, lte } }`,
       `include: { shift: { select: { name: true } } }`, `orderBy: { date: 'asc' }`.
     - `PrismaShiftAssignmentRepository.listByEmployee`: `findMany` ordered by `effectiveFrom`
       asc, mapped to `ShiftAssignment` (dates as `YYYY-MM-DD`).
     - `PrismaPunchRepository.listInstants`: `findMany({ where: { pin, occurredAt: { gte, lt } },
select: { occurredAt: true }, orderBy: { occurredAt: 'asc' } })`.
   - Observable result: migration applies; `pnpm db:generate` and `pnpm typecheck` pass.

6. **Adapters, in-memory, HTTP and DI**
   - Files: `apps/api/src/modules/attendance/infrastructure/employees-workday-employee-directory.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-workday.store.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-shift.store.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify), `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do:
     - `EmployeesWorkdayEmployeeDirectory`: maps `employeesApi.findEmployee` to the port, as
       `employees-shift-employee-directory.ts:9-17`.
     - `in-memory-workday.store.ts`: `InMemoryWorkdayStore`, `InMemoryWorkdayRepository`
       (`replaceDates` with the same semantics) and `InMemoryWorkdayQueries` (needs the
       `InMemoryShiftStore` for `shiftName`).
     - `InMemoryShiftAssignmentRepository.listByEmployee` and `InMemoryPunchRepository.listInstants`
       with the Prisma orderings and bounds.
     - Router: bind both routes like `attendance.router.ts:95-117`
       (`{ ...params, ...body }` / `{ ...params, ...query }`).
     - Module: register `workdayRepository`, `workdayQueries`, `workdayEmployeeDirectory`,
       `recalculateWorkdays`, `listEmployeeWorkdays` in `AttendanceCradle` and `registrations`
       (`attendance.module.ts:59-136`).
     - `test-app.ts`: one `InMemoryWorkdayStore` next to `test-app.ts:70`; register
       `workdayRepository` and `workdayQueries` with `asValue` next to `test-app.ts:172-174`.
   - Observable result: `pnpm check` passes (container, error catalog, arch).

7. **Docs**
   - Files: `docs/harness/modules.json` (modify), `docs/architecture.md` (modify)
   - Do: attendance summary in `modules.json` adds "Daily jornadas stored and recalculated on
     demand."; the legend `†` in `docs/architecture.md:25` becomes "marcaciones, checadores,
     turnos y jornadas".
   - Observable result: `pnpm check` passes.

## Acceptance criteria

Scenario: colaborador with RFC on a sede in `America/Cancun`, hired before 2026-10-05, assigned
from 2026-10-05 (a Monday) a Mon–Fri 09:00–18:00 shift with 60 min meal and tolerance 10, and
punches (local time):

- [ ] Recalculating 2026-10-05…2026-10-11 → 200 `{ recalculatedDates: 7, storedWorkdays: 6,
pendingDates: [] }` and the list returns, ascending:
      Mon 08:00/18:00 → `ATTENDED`, worked 540, overtime 60, late 0;
      Tue 09:15/18:00 → `ATTENDED`, late 15, worked 465, overtime 0;
      Wed 09:10/18:00 → `ATTENDED`, late 0, worked 470;
      Thu only 09:00 → `ABSENT_SINGLE_PUNCH`, punchCount 1;
      Fri none → `ABSENT_NO_PUNCHES`;
      Sat 10:00/12:00 → `REST_WORKED`, worked 120, overtime 120, scheduled times null;
      Sun none → no row.
- [ ] A night shift (cycle WORK 22:00–06:00 meal 30, REST) with punches 21:50 on D and 06:05 on
      D+1 → one `ATTENDED` row on D, worked 465, scheduled 450, overtime 15; no row on D+1.
- [ ] Recalculating a range that includes today → today is in `pendingDates` and has no row.
- [ ] Adding a punch and recalculating again replaces the rows (no duplicates; the changed day
      reflects the new punch).
- [ ] Dates before the hire date or after the termination date get no row; a terminated
      colaborador can still be recalculated. A terminated colaborador without a stored
      termination date → 422 `EMPLOYEE_INACTIVE` (no rows written).
- [ ] Colaborador without RFC → 422 `EMPLOYEE_WITHOUT_RFC`; of another company → 404
      `EMPLOYEE_NOT_FOUND`; `to < from` or 63 days → 400 `VALIDATION_ERROR`; HR of another
      company → 403.
- [ ] Rows in `attendance.workdays` match the API; `pnpm check` and `pnpm test:integration` pass.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `windowBoundaries`: day, night, 24x24, back-to-back and rest-after-night cases, non-decreasing rule; `calculateWorkdays`: every status, late vs tolerance edge (= tolerance is not late), meal deduction, early arrival overtime, rest worked with 1 and 2 punches, employment bounds, unassigned dates, open vs closed dates; `local-date` helpers. |
| application | yes     | `RecalculateWorkdays`: each error in order, assignment switching mid-range, shift loaded once, replace call with closed dates; `ListEmployeeWorkdays` 404.                                                                                                                                                                                           |
| contract    | yes     | Range refinements (order, 62 days), schemas, route access/errors.                                                                                                                                                                                                                                                                                    |
| http        | yes     | Both routes on the real container with pushed punches: the scenario above, company scoping (403/404), pending today.                                                                                                                                                                                                                                 |
| integration | yes     | `replaceDates` atomic replace, `listInstants` bounds/order across devices, `listByEmployee` ordering, queries with `shiftName`, the new index migration.                                                                                                                                                                                             |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                                                                                                                                          |

## Deviations

Implementation (2026-10-14). All 7 steps done; `pnpm check` and `pnpm test:integration` green.

1. **Cosmetic, out-of-list file.** Adding `PunchRepository.listInstants` (step 3) broke the
   typecheck of an inline punch-repository double in
   `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts:303-316`.
   Added a one-line `listInstants` that delegates to the in-memory repository; no assertion
   changed.
2. **Cosmetic, arch rule.** `in-memory-workday.store.ts` cannot import `InMemoryShiftStore`
   (`arch:check` → `no-test-code-in-production` forbids any non-test file importing from
   `/in-memory/`). `InMemoryWorkdayQueries` takes its second argument as a structural type
   `{ shifts: ReadonlyMap<string, { name }> }`, which `InMemoryShiftStore` satisfies; `test-app.ts`
   passes the shift store as the plan says.
3. **Bookkeeping (not a deviation).** Migration folder is `20261014205513_create_workdays`; the
   step 5 `Files:` line was updated.
4. **Interpretation notes (no design impact), for the tester/reviewer.**
   - `pendingDates` lists every open requested date, including ones outside employment or without
     a shift (they would produce no row anyway); `closedDates` = every closed requested date.
   - `ABSENT_SINGLE_PUNCH` stores the single punch in both `firstPunchAt` and `lastPunchAt`;
     absences store `lateMinutes`/`workedMinutes`/`overtimeMinutes` = 0 and the scheduled times.
   - The first calendar entry (`from − 1`) has no predecessor, so its boundary ignores the day
     before it; it only influences `b(from)` through the non-decreasing rule.
   - An assignment whose shift `findById` returns null throws (the FK makes it corruption).
   - `PrismaWorkdayRepository.replaceDates` returns early when `dates` is empty.
5. `pnpm plans:scope --base origin/main` also lists `employees.facade.ts`, its test and the
   `employees-fechas-laborales` plan files: those were changed by commits already on this branch
   (plan `employees-fechas-laborales/001`), not by this implementation.

## Test coverage

## Review findings

## Verification
