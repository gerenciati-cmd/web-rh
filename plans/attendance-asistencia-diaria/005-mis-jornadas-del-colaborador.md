---
status: approved
module: attendance
min_implementer: mid
depends_on: ['002', '003', 'identity-acceso/007']
---

# 005 — The colaborador's own jornadas (self-service)

## Context

The mobile "Mi asistencia" screen (mobile-app-colaborador/003) needs the signed-in colaborador
to read **their own** attendance. Today only staff can read jornadas:

- `GET /companies/:companyId/attendance/employees/:employeeId/workdays?from&to` requires
  `attendance.workdays:read` on the company (`packages/contracts/src/attendance/workday.contract.ts:140-156`).
- Its use case 404s an employee of another company (`application/queries/list-employee-workdays.query.ts:18-33`).
- It reads through the `WorkdayQueries.listByEmployee` port.
- The `WorkdaySchema` DTO carries:
  - date, shift, status (`ATTENDED`, `ABSENT_NO_PUNCHES`, `ABSENT_SINGLE_PUNCH`, `REST_WORKED`);
  - scheduled start, end and minutes;
  - first and last punch and punch count;
  - late, worked and overtime minutes (`workday.contract.ts:36-91`).

Jornadas are stored **only for closed dates** (their punch window has ended): "solo de fechas
cerradas … las abiertas se reportan como pendientes"
(`apps/api/src/modules/attendance/domain/workday-calculator.ts:94-95`). So **today never has a
stored jornada** while it is in progress, and "today" needs its own read: the shift that applies
and the punches so far.

**The pieces "today" reuses:**

- `RecalculateWorkdays` resolves the colaborador:
  - RFC as punch PIN, sede → `site.timeZone`, hire and termination dates
    (`application/commands/recalculate-workdays.command.ts:73-97`);
  - the assignment on a date (`assignmentOn`, lines 47-58);
  - a calendar `from − 1 … to + 1` with each date's shift day and tolerance (private
    `buildCalendar`, lines 130-158).
- It derives the punch windows with `windowBoundaries(calendar, timeZone)` and reads punches with
  `punchRepository.listInstants(rfc, boundaries[1], boundaries.at(-1))` (lines 103-108).
- The window of calendar date `i` is `[b(i), b(i+1))` (`workday-calculator.ts:34-39`).
- The scheduled start and end, including a night shift ending the next day, are computed by
  private `scheduledStart`/`scheduledEnd` (`workday-calculator.ts:21-28`). `workMinutes(day)` is
  exported from `domain/shift.ts:51`.
- `domain/local-date.ts` has `addDays`, `daysBetween` and `localInstant` (lines 11-28), but **no
  "local date of an instant"** helper, and `@rrhh/domain` exposes none either. `localDateTimeToUtc`
  only goes local → UTC.
- `WorkdayEmployee` has `id`, `companyId`, `active`, `rfc`, `siteId`, `hireDate` and
  `terminationDate` (`application/ports/workday-employee-directory.ts:6-16`).

**Access.** identity-acceso/007 adds:

- `Actor.employeeId`;
- the permission `attendance.workdays:read-own`, granted to EMPLOYEE (and to HOLDING_ADMIN, which
  has every permission);
- the rule that own-data routes resolve the colaborador only from the actor (identity decision
  32).

`bindRoute` hands handlers the `RequestContext` with `actor` (`apps/api/src/http/bind-route.ts:50-67`),
and routes are bound in `http/attendance.router.ts`, for example at lines 127-129.

**Chosen approach:** two read-only routes under `/me/attendance`.

- `GET /me/attendance/workdays?month=YYYY-MM` returns the stored jornadas of the current or the
  previous month, in the site's time zone (README decision 24). It reuses `WorkdayQueries`. A
  month parameter instead of `from`/`to` keeps the history rule in the API, and a month always
  fits under the 62-day limit.
- `GET /me/attendance/today` returns:
  - today's local date and the time zone;
  - the shift that applies (`WORK` with scheduled start and end instants, meal and tolerance, or
    `REST`), or `null` when no shift applies or today is outside employment;
  - the punch instants inside today's window.

  It reuses the calendar and window rules **without duplicating them**:
  - `buildCalendar` and `assignmentOn` move to an application-level helper that both use cases
    import;
  - `scheduledStart`/`scheduledEnd` become exported from the calculator.

- The colaborador sees everything HR sees about their own days, overtime included (README
  decision 23).

**Alternative rejected:** computing today's partial jornada (lateness so far). It would be a
second, provisional calculation with legal weight. The screen derives "a tiempo / retardo" only
after the jornada closes; today shows the plan and the raw punches.

**Imitated files:**

- `application/queries/list-employee-workdays.query.ts` for the use case shape;
- `workday.contract.ts` for the route definitions and descriptions;
- the `EMPLOYEE_WITHOUT_SITE` entry in `packages/contracts/src/errors.ts:393-404` for new error
  entries.

## Out of scope

- Any change to how jornadas are calculated, stored or recalculated.
- The "N retardos = 1 falta" rule (plan 004, not written).
- A provisional jornada for today.
- Punches outside today's window.
- Staff routes; mobile screens (mobile-app-colaborador/003); identity changes
  (identity-acceso/007).
- A history longer than the previous month (README decision 24).

## Dependencies

- **002 (`done`):**
  - `WorkdayQueries.listByEmployee(employeeId, from, to)`;
  - `WorkdaySchema`/`WorkdayDto`;
  - `windowBoundaries`;
  - the stored-jornada rules.
- **003 (`done`):** automatic recalculation, so closed days appear without staff action.
- **identity-acceso/007 (not `done` yet; the implementer waits):**
  - `Actor.employeeId: string | null`;
  - the permission `'attendance.workdays:read-own'` in `@rrhh/domain` `PERMISSIONS`;
  - EMPLOYEE granting it;
  - the test helper `signInAsEmployee(container, { companyId, employeeId })` in
    `apps/api/tests/test-app.ts`.

## Steps

1. **Local date of an instant**
   - Files: `apps/api/src/modules/attendance/domain/local-date.ts` (modify)
   - Do: export `localDateOf(instant: Date, timeZone: string): string`. It returns the
     `YYYY-MM-DD` wall date of `instant` in `timeZone`, using `Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })`
     and its `format`. Spanish docblock.
   - Observable result: `localDateOf(new Date('2026-11-11T04:30:00Z'), 'America/Cancun')`
     returns `'2026-11-10'` (Cancún is UTC−5).

2. **Expose the scheduled-time helpers**
   - Files: `apps/api/src/modules/attendance/domain/workday-calculator.ts` (modify)
   - Do: add `export` to `scheduledStart` and `scheduledEnd` (lines 21-28). Bodies unchanged.
   - Observable result: the existing calculator tests pass unchanged.

3. **Shared employee calendar**
   - Files: `apps/api/src/modules/attendance/application/employee-calendar.ts` (create), `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts` (modify)
   - Do:
     - Move `assignmentOn` (lines 47-58) and the body of `buildCalendar` (lines 130-158)
       verbatim into `employee-calendar.ts`, as:
       - `export function assignmentOn(...)`;
       - `export async function buildEmployeeCalendar(deps: { shiftAssignmentRepository: ShiftAssignmentRepository; shiftRepository: ShiftRepository }, employeeId: string, from: string, span: number): Promise<PlannedDate[]>`.
     - `RecalculateWorkdays` calls
       `buildEmployeeCalendar(this.deps, employee.id, input.from, span)` and drops its private
       copies.
     - Pure refactor: no behavior change.
   - Observable result: every existing recalculation test (unit, http, integration) passes
     unchanged.

4. **Contracts: routes, schemas and errors**
   - Files: `packages/contracts/src/attendance/my-attendance.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/src/errors.ts` (modify), `packages/contracts/openapi.json` (modify, regenerated)
   - Do:
     - `MyWorkdaysQuerySchema`:
       `z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).describe('Mes YYYY-MM: el actual o el anterior, en la zona de la sede') })`.
     - `MyTodaySchema` (`meta id 'AttendanceMyToday'`):
       ```
       {
         date: iso date,
         timeZone: string,
         shift: null | {
           id: uuid,
           name: string,
           day:
             | { type: 'REST' }
             | {
                 type: 'WORK',
                 scheduledStartAt: iso datetime,
                 scheduledEndAt: iso datetime,
                 scheduledMinutes: int,
                 mealBreakMinutes: int,
                 toleranceMinutes: int,
               },
         },
         punches: iso datetime[],  // ascending
       }
       ```
       Use `z.discriminatedUnion('type', …)` for `day`, and Spanish `.describe` on every field.
     - Routes `myAttendanceRoutes`:
       - `listMyWorkdays`: GET `/me/attendance/workdays`, query `MyWorkdaysQuerySchema`,
         response `{ month: string, items: WorkdaySchema[] }`.
       - `getMyAttendanceToday`: GET `/me/attendance/today`, response `MyTodaySchema`.
       - Both use `access: requires('attendance.workdays:read-own')` and
         `errors: ['ACCOUNT_NOT_LINKED', 'EMPLOYEE_NOT_FOUND', 'EMPLOYEE_WITHOUT_SITE', 'SITE_NOT_FOUND']`.
         `listMyWorkdays` adds `'MONTH_NOT_AVAILABLE'`.
       - Descriptions in the same markdown style as `workday.contract.ts:120-127`. "Quién puede":
         the colaborador, only about themself.
     - Register `myAttendance: myAttendanceRoutes` in `apiRoutes` and export the module from
       `index.ts`.
     - `errors.ts`: add `ACCOUNT_NOT_LINKED` and `MONTH_NOT_AVAILABLE`, each with status 422, a
       Spanish description and one example, imitating lines 393-404.
       - `ACCOUNT_NOT_LINKED`: "La cuenta no está vinculada a un colaborador."
       - `MONTH_NOT_AVAILABLE`: "Solo puedes consultar el mes actual y el anterior.", details
         `{ month }`.
     - Regenerate `openapi.json` with `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: `pnpm --filter @rrhh/contracts test` passes, including the error-catalog
     and OpenAPI drift tests.

5. **Domain errors**
   - Files: `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do: add both classes, imitating `EmployeeWithoutSiteError` (lines 99-105):
     - `AccountNotLinkedError` (code `ACCOUNT_NOT_LINKED`, message
       `La cuenta no está vinculada a un colaborador`, no details);
     - `MonthNotAvailableError(month)` (code `MONTH_NOT_AVAILABLE`, message
       `Solo puedes consultar el mes actual y el anterior`, details `{ month }`).

     Both extend `BusinessRuleViolationError` (422).

   - Observable result: typecheck passes.

6. **Use case: my workdays**
   - Files: `apps/api/src/modules/attendance/application/queries/list-my-workdays.query.ts` (create)
   - Do: `ListMyWorkdays` with deps `{ workdayEmployeeDirectory, deviceSiteDirectory, workdayQueries, clock }`,
     input `{ employeeId: string | null; month: string }`. In order:
     1. If `employeeId` is null → `AccountNotLinkedError`.
     2. Find the employee; if missing → `EmployeeNotFoundError`.
     3. If `siteId` is null → `EmployeeWithoutSiteError`; if the site is missing →
        `SiteNotFoundError`.
     4. `today = localDateOf(clock.now(), site.timeZone)`. `current = today.slice(0, 7)`.
        `previous` is the month before `current` (January → December of the previous year).
     5. If `month` is neither → `MonthNotAvailableError(month)`.
     6. `from = ${month}-01`; `to` = the last day of the month (the first of the next month
        minus 1 day, with `addDays`).
     7. Return `ok({ month, items: await workdayQueries.listByEmployee(employee.id, from, to) })`.
   - Observable result: unit-testable with the in-memory adapters and a fixed `Clock`.

7. **Use case: my attendance today**
   - Files: `apps/api/src/modules/attendance/application/queries/get-my-attendance-today.query.ts` (create)
   - Do: `GetMyAttendanceToday` with deps `{ workdayEmployeeDirectory, deviceSiteDirectory, shiftAssignmentRepository, shiftRepository, punchRepository, clock }`,
     input `{ employeeId: string | null }`.
     1. Apply the same `null`, missing-employee and site checks as step 6.
     2. `today = localDateOf(clock.now(), tz)`.
     3. If `today < employee.hireDate`, or `employee.terminationDate !== null && today > employee.terminationDate`,
        return `{ date: today, timeZone: tz, shift: null, punches: [] }`.
     4. `calendar = await buildEmployeeCalendar(deps, employee.id, today, 0)`, which gives
        `[today−1, today, today+1]`, and `plan = calendar[1]?.plan`. If there is no plan, return
        the same empty shape.
     5. `shift = await shiftRepository.findById(plan.shiftId)`. If it is missing, throw
        `Error`: it is corruption, as in `recalculate-workdays.command.ts:144`.
     6. `day`:
        - REST → `{ type: 'REST' }`;
        - WORK → `{ type: 'WORK', scheduledStartAt: scheduledStart(today, plan.day, tz).toISOString(), scheduledEndAt: scheduledEnd(...).toISOString(), scheduledMinutes: workMinutes(plan.day), mealBreakMinutes: plan.day.mealBreakMinutes, toleranceMinutes: plan.toleranceMinutes }`.
     7. Punches: if `employee.rfc` is null, use `[]`. Otherwise
        `b = windowBoundaries(calendar, tz)` and
        `punches = await punchRepository.listInstants(employee.rfc, b[1], b[2])`, mapped to ISO
        strings and sorted ascending. This is today's window, `[b(1), b(2))`, as the
        recalculation reads it at `recalculate-workdays.command.ts:104-108`.
     8. Return `ok({ date: today, timeZone: tz, shift: { id: shift.id, name: shift.name, day }, punches })`.
   - Observable result: unit-testable. For a 09:00–18:00 shift in Cancún, a punch at 08:56 local
     today is listed, and yesterday's punches are not.

8. **Wire module and routes**
   - Files: `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `docs/harness/modules.json` (modify)
   - Do:
     - Register `listMyWorkdays` and `getMyAttendanceToday` as singletons, with their cradle
       types next to `listEmployeeWorkdays` (`attendance.module.ts:109, 169`).
     - In the router, bind both routes. The handler passes
       `employeeId: context.actor?.employeeId ?? null` (the actor exists, since `authorize`
       already required it), plus `query.month` for workdays, then `unwrap`.
     - Append to the attendance summary in `modules.json`: "Colaboradores read their own jornadas
       and today's shift and punches (`/me/attendance`)."
   - Observable result:
     - `tests/container.test.ts` resolves everything.
     - A colaborador gets 200 from both routes.
     - HR gets 403, because it lacks `read-own`.
     - An unlinked HOLDING_ADMIN gets 422 `ACCOUNT_NOT_LINKED`.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass.
- [ ] A colaborador (invited and activated, with RFC, sede and shift) calls
      `GET /me/attendance/workdays?month=<current>` and gets 200 with exactly their stored
      jornadas for that month, using the same fields as the staff route.
- [ ] `month` = the previous month gives 200. Two months back or a future month gives 422
      `MONTH_NOT_AVAILABLE`. A malformed `month` (`2026-13`) gives 400 `VALIDATION_ERROR`.
- [ ] `GET /me/attendance/today`:
  - returns today's local date in the site zone;
  - for a working day, returns the shift with scheduled start and end instants, minutes, meal
    and tolerance, plus the punches inside today's window;
  - on a rest day, returns `day: { type: 'REST' }`;
  - with no assignment, returns `shift: null`.
- [ ] No route accepts an employee id: a colaborador can only ever see themself.
- [ ] HR without `read-own` gets 403. HOLDING_ADMIN without a linked colaborador gets 422
      `ACCOUNT_NOT_LINKED`. Anonymous gets 401.
- [ ] A colaborador without a sede gets 422 `EMPLOYEE_WITHOUT_SITE`.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `localDateOf`: date-line cases around midnight in Cancún and Mexico City, and a UTC instant on the previous local day                                                                                                                                                                                                                                                                                                                                                      |
| application | yes     | `ListMyWorkdays`: null employeeId; missing employee, site or sede; current, previous, older and future months; January → previous December; last day of the month (28, 29, 30, 31). `GetMyAttendanceToday`: working day with punches inside and outside the window; night shift 22:00–06:00 (end next day, window); rest day; no assignment; before hire and after termination; no RFC → no punches. `RecalculateWorkdays` tests still pass after the calendar extraction. |
| contract    | yes     | `MyWorkdaysQuerySchema` regex; `MyTodaySchema` discriminated `day`; catalog entries for both new codes                                                                                                                                                                                                                                                                                                                                                                     |
| http        | yes     | via `signInAsEmployee`: 200 and the shapes of both routes; 422 `MONTH_NOT_AVAILABLE`; 403 for HR; 422 `ACCOUNT_NOT_LINKED` for HOLDING_ADMIN; 401 anonymous                                                                                                                                                                                                                                                                                                                |
| integration | no      | No new adapter or schema; it reuses `PrismaWorkdayQueries` and the punch repository already covered                                                                                                                                                                                                                                                                                                                                                                        |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Deviations

## Test coverage

## Review findings

## Verification
