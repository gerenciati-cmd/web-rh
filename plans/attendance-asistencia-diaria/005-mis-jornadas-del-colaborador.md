---
status: done
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

- Cosmético: `packages/contracts/src/openapi.test.ts` tenía el conteo de operaciones fijo (38); se actualizó a 40 (las dos rutas nuevas) para que el catálogo y el OpenAPI sigan en verde. Fuera de la lista del plan; sin impacto de diseño.
- Cosmético: `GetMyAttendanceToday` extrae `punchesInWindow` como método privado (bajar la complejidad ciclomática del lint); comportamiento idéntico al paso 7.

## Test coverage

Línea base (`pnpm check` antes de escribir tests): verde. Los 4 archivos nuevos y 1 ampliado
pasan por separado; ningún test se debilitó ni quedó marcado `GAP` / `NOT CONFIRMED`: todo el
comportamiento del plan está implementado y confirmado por ejecución. Capa integración: no aplica
(sin adaptador ni esquema nuevos, como declara el plan). La unicidad de códigos del catálogo de
errores contra las clases reales ya la cubre el test genérico `tests/error-catalog.test.ts`, que
recorre los `errors.ts` del módulo (incluye las dos clases nuevas).

| Comportamiento                                                                       | Fuente                                                        | Capa             | Test                                                                           | Estado    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------ | --------- |
| `localDateOf`: fecha local de un instante (Cancún UTC−5, CDMX UTC−6, medianoche)     | `domain/local-date.ts` `localDateOf`                          | domain           | `local-date.test.ts › localDateOf`                                             | CONFIRMED |
| `ListMyWorkdays`: null → `ACCOUNT_NOT_LINKED`; empleado/sede/sin sede                | `list-my-workdays.query.ts:41-50`                             | application      | `list-my-workdays.query.test.ts` (4 tests de error)                            | CONFIRMED |
| Mes actual y anterior permitidos; antiguo, futuro y otro año → `MONTH_NOT_AVAILABLE` | `list-my-workdays.query.ts:52-57`                             | application      | `list-my-workdays.query.test.ts › mes actual / anterior / it.each`             | CONFIRMED |
| Enero → diciembre previo; "hoy" por zona de la sede                                  | `list-my-workdays.query.ts:52-54`                             | application      | `› en enero…`, `› "hoy" se decide en la zona…`                                 | CONFIRMED |
| Último día del mes (28, 29, 30, 31) inclusivo, primero del siguiente fuera           | `list-my-workdays.query.ts:59-65`                             | application      | `› it.each` de 5 meses                                                         | CONFIRMED |
| Solo jornadas propias del colaborador                                                | `list-my-workdays.query.ts:67-69`                             | application      | `› mes actual: solo las propias`                                               | CONFIRMED |
| `GetMyAttendanceToday`: errores de cuenta, empleado, sede                            | `get-my-attendance-today.query.ts:45-54`                      | application      | `› acceso y datos del colaborador`                                             | CONFIRMED |
| Día laborable: turno, instantes, minutos, comida, tolerancia                         | `get-my-attendance-today.query.ts:78-88`                      | application      | `› día laborable`                                                              | CONFIRMED |
| Ventana de hoy: marcaciones dentro/fuera, orden ascendente, solo del RFC propio      | `get-my-attendance-today.query.ts:108-122`                    | application      | `› lista las marcaciones…`, `› solo muestra…`                                  | CONFIRMED |
| Sin RFC → sin marcaciones, turno visible                                             | `get-my-attendance-today.query.ts:105-106`                    | application      | `› sin RFC…`                                                                   | CONFIRMED |
| Turno nocturno 22:00–06:00: salida al día siguiente y ventana                        | `workday-calculator.ts:26-28`, `:34-39`                       | application      | `› turno nocturno`                                                             | CONFIRMED |
| Descanso → `{ type: 'REST' }`; sin asignación / asignación futura → `shift: null`    | `get-my-attendance-today.query.ts:62-69, 78`                  | application      | `› día de descanso`, `› sin turno que aplique`                                 | CONFIRMED |
| Turno asignado inexistente lanza `Error` (corrupción)                                | `employee-calendar.ts`, `get-my-attendance-today.query.ts:72` | application      | `› turno asignado inexistente`                                                 | CONFIRMED |
| Antes del ingreso / después de la baja → `shift: null`; bordes inclusivos            | `get-my-attendance-today.query.ts:58-61`                      | application      | `› fuera de la contratación` (4 tests)                                         | CONFIRMED |
| `RecalculateWorkdays` sigue verde tras extraer el calendario                         | `employee-calendar.ts`                                        | application/http | `recalculate-workdays` y `attendance-workdays.test.ts` existentes, sin cambios | CONFIRMED |
| `MyWorkdaysQuerySchema`: regex `YYYY-MM` (acepta 01–12, rechaza 13, 00, formatos)    | `my-attendance.contract.ts:8-13`                              | contract         | `my-attendance.contract.test.ts › MyWorkdaysQuerySchema`                       | CONFIRMED |
| `MyTodaySchema`: unión discriminada `day`, `shift` null, ISO y uuid                  | `my-attendance.contract.ts:15-45`                             | contract         | `my-attendance.contract.test.ts › MyTodaySchema`                               | CONFIRMED |
| Rutas: permiso `read-own`, sin ids en la ruta, errores existen en el catálogo        | `my-attendance.contract.ts:55-92`                             | contract         | `my-attendance.contract.test.ts › myAttendanceRoutes`                          | CONFIRMED |
| Catálogo: `ACCOUNT_NOT_LINKED` y `MONTH_NOT_AVAILABLE` (422, ejemplo, detalles)      | `errors.ts:405-426`                                           | contract         | `my-attendance.contract.test.ts › catálogo…`                                   | CONFIRMED |
| `/me/attendance/workdays`: 200, mismos campos que personal, mes anterior, 422/400    | `attendance.router.ts`, contrato                              | http             | `tests/attendance-my-workdays.test.ts › GET /me/attendance/workdays`           | CONFIRMED |
| Ninguna entrada elige al colaborador (un `employeeId` en la consulta se ignora)      | `attendance.router.ts` (`ctx.actor?.employeeId`)              | http             | `› ninguna entrada elige al colaborador…`                                      | CONFIRMED |
| `/me/attendance/today`: laborable con marcaciones, descanso, sin turno               | `attendance.router.ts`, `get-my-attendance-today`             | http             | `› GET /me/attendance/today` (3 tests)                                         | CONFIRMED |
| 401 anónimo, 403 RR. HH., 422 `ACCOUNT_NOT_LINKED` (HOLDING_ADMIN), 422 sin sede     | `bind-route.ts`, `list-my-workdays` / `today`                 | http             | `› acceso y errores de cuenta` (2 rutas cada uno)                              | CONFIRMED |

Conteo (casos expandidos): domain 5; application 17 (`ListMyWorkdays`) + 18
(`GetMyAttendanceToday`); contract 24; http 22. Sin hallazgos fuera de alcance.

## Review findings

Revisión 2026-11-10 (reviewer, subagente). Diff revisado: `git diff 78b89ee` + archivos untracked
del plan (se excluyen `apps/mobile/.gitignore` y `docs/referencia/`, ajenos al plan).

**Checklist: 13/13 PASS.**

- [x] Alcance: `pnpm plans:scope` contra `origin/main` falla porque cuenta los commits previos de la
      rama (identity-acceso/007, ya `done`, y anteriores). Limitado a los cambios sobre `78b89ee`:
      los 14 archivos declarados + tests del tester (`local-date.test.ts`, dos `*.query.test.ts`,
      `my-attendance.contract.test.ts`, `tests/attendance-my-workdays.test.ts`) + `openapi.test.ts`
      (declarado en Deviations). Hot files (`contracts/src/index.ts`, `modules.json`) solo agregan.
- [x] `pnpm check` verde (formato, tipos, lint, tests, arch, planes, harness, hooks, quality).
- [x] `pnpm test:integration` verde (20 archivos, 269 tests) — no cambió `infrastructure/`, pero se
      corrió por el criterio de aceptación y por el refactor del calendario del recálculo.
- [x] Reglas de negocio: cálculo de ventanas/horarios sigue en `domain/workday-calculator.ts`; el
      router solo toma `ctx.actor?.employeeId` y hace `unwrap`.
- [x] CQRS-lite: ambos son lecturas; `ListMyWorkdays` usa `WorkdayQueries`; `GetMyAttendanceToday`
      lee por repositorios existentes como el plan prescribe (sin métodos nuevos de pantalla).
- [x] Tipos de request/response salen de `@rrhh/contracts` (`MyWorkdaysDto`, `MyTodayDto`).
- [x] Errores esperados: `Result` + `AccountNotLinkedError`/`MonthNotAvailableError`
      (`BusinessRuleViolationError`, 422, códigos estables, en el catálogo).
- [x] Fechas/tiempo: `Clock` para "ahora", fecha local vía `localDateOf` con la zona de la sede.
- [x] Esquema: sin cambios, sin migración.
- [x] DI: dos singletons nuevos, `tests/container.test.ts` verde.
- [x] Sin secretos ni datos personales reales (CURP/RFC de fixtures sintéticos, correos `.example`).
- [x] Deviations honestas: verificado `openapi.test.ts` (38 → 40) y el método privado
      `punchesInWindow` (`get-my-attendance-today.query.ts:99-115`), mismo rango `[b(1), b(2))`.
- [x] Docs: `modules.json` actualizado; no hay otra doc que describa rutas `/me` o `read-own`.

**Bug hunt:** trazado contrato → `bindRoute`/`authorize` (sin `companyParam`: permiso global de
`read-own`, el colaborador sale solo del actor, la query extra se descarta por `z.object`) → casos
de uso → `buildEmployeeCalendar`/`windowBoundaries` → DTO. Verificado: mes anterior en enero
(`addDays` del día 1), último día del mes con `Date.UTC(y, m, 1)` (diciembre → enero siguiente),
"hoy" en la zona de la sede, ventana de hoy idéntica a la que usa el recálculo (calendario
`[ayer, hoy, mañana]`, `b[1]..b[2]`), refactor del calendario verbatim. Sin tenencia cruzada
posible: no hay id en la entrada.

**Findings que requieren cambio: ninguno.**

Observaciones (sin acción, para el usuario / verificación):

- Info — `get-my-attendance-today.query.ts:61-66`: un colaborador con `active: false` y
  `terminationDate: null` (baja anterior a guardar la fecha) recibe turno y marcaciones de hoy,
  mientras `RecalculateWorkdays` lo rechaza con `EMPLOYEE_INACTIVE`. Incierto si puede ocurrir:
  depende de que una baja deshabilite la sesión (identity), no verificado aquí. El plan no pide el
  chequeo, así que no es desviación.
- Info — por diseño del plan ("Punches outside today's window" fuera de alcance): a las 02:00 de
  un turno nocturno 22:00–06:00 iniciado ayer, `/me/attendance/today` muestra el turno de hoy y no
  las marcaciones del turno en curso (pertenecen a la ventana de ayer, que aún no tiene jornada
  guardada). Conviene que mobile-app-colaborador/003 lo tenga presente al diseñar la pantalla.

## Verification

Verifier (inline, sesión principal), 2026-11-10 (martes). Resultado: **PASS**.

- Suites: `pnpm check` verde (api 1489 + 5 skipped, contracts 415, domain 98, mobile 78; los 2
  warnings de lint son previos). `pnpm test:integration` verde en la revisión (20 archivos, 269
  tests); sin cambios de código desde entonces.
- App corriendo: API (`pnpm dev`, puerto 3000) y worker sobre la base de desarrollo.
- Datos, por los casos de uso reales (script temporal fuera del repo) y por el protocolo del
  equipo:
  - colaboradora sembrada Ana Rojas (activada en la verificación de identity-acceso/007), sede
    Cancún Centro (`America/Cancun`);
  - equipo `VERIFYCARIBE1` en su sede, turno "Oficina 9 a 18" (L-V 09:00-18:00, comida 60,
    tolerancia 10) asignado desde 2026-10-01;
  - 16 marcaciones por `POST /iclock/cdata?table=ATTLOG` (respuesta `OK: 16`) del 29-10 al 10-11,
    y recálculo 2026-10-01..2026-11-09 (40 fechas, 29 jornadas guardadas).
- Criterios de aceptación, con el token móvil de Ana:
  - [x] Suites verdes (arriba).
  - [x] `GET /me/attendance/workdays?month=2026-11` → 200 con sus 7 jornadas de noviembre:
        asistencia, entrada temprana con 90 min extra (02-11), falta por una marcación (03-11),
        falta sin marcaciones (04-11), descanso trabajado con 240 min (07-11). Mismos campos que la
        ruta de personal (`WorkdaySchema`); los domingos de descanso sin marcaciones no se guardan.
  - [x] `month=2026-10` → 200 (22 jornadas, retardo de 22 min el 30-10). `2026-09` y `2026-12`
        → 422 `MONTH_NOT_AVAILABLE`; `2026-13` y `2026-1` → 400 `VALIDATION_ERROR`.
  - [x] `GET /me/attendance/today` → 200 con `date: 2026-11-10`, `timeZone: America/Cancun`,
        turno WORK de 14:00Z a 23:00Z (09:00-18:00 locales), 480 min, comida 60, tolerancia 10, y
        la marcación de hoy 08:57 local. Antes de asignar el turno respondía `shift: null`.
        Día de descanso: cubierto por los tests http (hoy es martes).
  - [x] Ninguna ruta acepta id: `?employeeId=<otro>` se ignora y devuelve sus propias jornadas.
  - [x] Anónimo → 401. HR → 403, HOLDING_ADMIN sin vínculo → 422 `ACCOUNT_NOT_LINKED` y sin sede
        → 422 `EMPLOYEE_WITHOUT_SITE`: cubiertos por los tests http; en la app no se ejercitaron
        porque las contraseñas del staff viven en `.env`, que no se lee.
- Los datos de Ana (turno, marcaciones, jornadas) quedan en la base de desarrollo para verificar
  mobile-app-colaborador/003.
