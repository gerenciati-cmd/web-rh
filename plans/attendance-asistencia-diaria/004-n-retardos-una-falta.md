---
status: done
module: attendance
min_implementer: mid
depends_on: ['002', '003', '005']
---

# 004 — N retardos = 1 falta

## Context

A retardo is stored today only as minutes on an attended day:

- `calculateWorkdays` sets `lateMinutes: late > plan.toleranceMinutes ? late : 0`
  (`apps/api/src/modules/attendance/domain/workday-calculator.ts:211`). So a day is a retardo
  exactly when its status is `ATTENDED` and `lateMinutes > 0`.
- The statuses are `ATTENDED`, `ABSENT_NO_PUNCHES`, `ABSENT_SINGLE_PUNCH` and `REST_WORKED`
  (`packages/domain/src/attendance/workday-rules.ts:7-12`). The column is a free
  `VarChar(24)` (`apps/api/prisma/schema.prisma`, model `AttendanceWorkday`, `status`), so a new
  value needs no migration of `workdays`.
- The contract derives its enum from `WORKDAY_STATUSES`
  (`packages/contracts/src/attendance/workday.contract.ts:41-50`).
- `RecalculateWorkdays` computes the closed dates of a range and replaces them with
  `workdayRepository.replaceDates`, inside a per-employee lock
  (`apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts:83-109`).
  Every recalculation path goes through it: the manual endpoint, the punch and assignment jobs,
  and the hourly close (plan 003).
- `WorkdayRepository` only has `replaceDates` and `lockEmployee`
  (`apps/api/src/modules/attendance/domain/workday.repository.ts:3-18`).
- Companies have no attendance settings anywhere. The `Company` model has only identity fields
  (`apps/api/prisma/schema.prisma`, model `Company`).
- Mobile maps each status in two exhaustive switches
  (`apps/mobile/src/features/attendance/format.ts:69-82, 93-117`). A new status breaks its
  typecheck until it is handled.

**What the user decided** (README decisions 26-30):

- Each company chooses N and the period: week (Monday–Sunday), fortnight (1–15 and 16–end of
  month) or calendar month.
- The day of the retardo that completes N becomes a falta: status `ABSENT_LATENESS`, keeping its
  `lateMinutes`.
- One falta per full block of N. With N=3, 7 retardos give 2 faltas (3rd and 6th); the 7th does
  not carry over to the next period.
- A company with no rule uses N=3 per fortnight.
- A rule change has an effective date and keeps history; earlier periods keep the rule they had.

**Chosen approach.**

1. **A rule history per company** (`attendance.lateness_rules`), shaped like shift assignments:
   `PUT .../lateness-rules/:effectiveFrom` inserts or replaces, and `GET` lists it
   (`assignEmployeeShift` in `packages/contracts/src/attendance/shift.contract.ts:177-198`;
   `ShiftAssignmentRepository` in `apps/api/src/modules/attendance/domain/shift-assignment.repository.ts:3-13`).
2. **Periods are cut at a rule change.** For each date, the rule in effect is the latest one with
   `effectiveFrom <= date`, or the default. A counting period ("segment") is that rule's period
   that contains the date, clipped to the rule's validity: from its `effectiveFrom` to the day
   before the next rule's `effectiveFrom`.
3. **`effectiveFrom` cannot be in the past** (before the clock's UTC date). Stored jornadas are
   all before today, so a new rule never changes a stored day, and no company-wide recalculation
   is needed (decision 22). Every site zone of the holding is behind UTC, so "today in UTC" is
   never earlier than any site's local today.
4. **The rule runs inside `RecalculateWorkdays`, after the daily calculation.** It loads the
   stored jornadas of every segment that touches the recalculated range, merges them with the new
   ones, and recounts each segment from scratch:
   - `ABSENT_LATENESS` goes back to `ATTENDED`;
   - then, in date order, every N-th retardo becomes `ABSENT_LATENESS`.

   All of this is written in the same `replaceDates` call. So a late punch that removes an
   earlier retardo also restores the day that had become a falta. When the next days of a
   period close, the hourly close recounts the period.

5. **Permissions:** the rule reuses `attendance.shifts:manage` / `attendance.shifts:read`. They
   are the company's attendance-rule permissions, already granted to HR and HOLDING_ADMIN. A new
   permission would need a change to the identity role catalog.
6. **Mobile:** an `ABSENT_LATENESS` day shows "Falta · Por retardos". The month summary counts it
   both as a falta and as a retardo, so the Retardos tile still matches the retardos the person
   had.

Imitated files:

- the shift catalog: `create-shift.command.ts:31-32`, which checks that the company exists
  through `shiftCompanyDirectory`;
- the assignment route and its binding (`apps/api/src/modules/attendance/http/attendance.router.ts:113-122`);
- the in-memory stores wired in `apps/api/tests/test-app.ts:76-77, 179-183`.

## Out of scope

- Recalculating stored jornadas when a rule is set, or setting a rule in the past. Both are
  ruled out by the "not in the past" check.
- Showing or editing the rule in any UI. Web is not built yet; mobile only shows the new status.
- Payroll effects: discounting the falta, or whether its worked minutes are paid.
- Other rules, such as retardo minutes accumulating into a falta, or tolerance per company.
- The hallazgo `plans/hallazgos/attendance-baja-sin-fecha-en-la-jornada.md`.

## Dependencies

- **002 (`done`):** `calculateWorkdays`, `Workday`, `WorkdayRepository.replaceDates`,
  `RecalculateWorkdays` with the per-employee lock.
- **003 (`done`):** the recalculation jobs and the hourly close, which all call
  `RecalculateWorkdays`.
- **005 (`done`):** `GET /me/attendance/workdays` and the mobile Asistencia screen, which receive
  the new status.

## Steps

1. **Shared vocabulary**
   - Files: `packages/domain/src/attendance/workday-rules.ts` (modify), `packages/domain/src/attendance/lateness-rules.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do:
     - In `WORKDAY_STATUSES`, add `'ABSENT_LATENESS'` after `'ABSENT_SINGLE_PUNCH'`, and extend
       the docblock: a falta made from N retardos (decision 27).
     - Create `lateness-rules.ts` with:
       - `LATENESS_PERIODS = ['WEEK', 'FORTNIGHT', 'MONTH'] as const` and `LatenessPeriod`;
       - `DEFAULT_LATENESS_RULE = { threshold: 3, period: 'FORTNIGHT' } as const` (decision 29);
       - `MAX_LATENESS_THRESHOLD = 31`.

       Add a Spanish docblock citing decisions 26-30.

     - Export the new file from `index.ts`, the same way `workday-rules` is exported.
   - Observable result: `pnpm --filter @rrhh/domain typecheck` passes.

2. **Domain: periods, segments and the count**
   - Files: `apps/api/src/modules/attendance/domain/lateness-rule.ts` (create), `apps/api/src/modules/attendance/domain/lateness-rule.repository.ts` (create)
   - Do: in `lateness-rule.ts`, define:
     - `LatenessRule { companyId; effectiveFrom: string; threshold: number; period: LatenessPeriod; setAt: Date; setBy: string }`.
     - `latenessPeriodOf(date, period): { start: string; end: string }`, all `YYYY-MM-DD`:
       - `WEEK`: Monday to Sunday;
       - `FORTNIGHT`: days 1–15, or day 16 to the last of the month;
       - `MONTH`: day 1 to the last day of the month.

       Work on the calendar date only, with UTC `Date` arithmetic.

     - `latenessSegments(rules, from, to): { start: string; end: string; threshold: number }[]`.
       - `rules` are sorted by `effectiveFrom` ascending.
       - For each date in `[from, to]`, the effective rule is the last one with
         `effectiveFrom <= date`. If none applies, the default applies, valid until the day
         before the first rule.
       - The segment is `latenessPeriodOf(date, rule.period)`, clipped to start no earlier than
         the rule's `effectiveFrom` and end no later than the day before the next rule's
         `effectiveFrom`.
       - Return each distinct segment once, ascending, whole: not clipped to `[from, to]`.
     - `applyLatenessRule(workdays, threshold, now): Workday[]` for the jornadas of one segment.
       - It returns new objects and never mutates its input.
       - Every `ABSENT_LATENESS` goes back to `ATTENDED`.
       - The days with `status === 'ATTENDED' && lateMinutes > 0`, in ascending date order, are
         numbered 1, 2, 3, …; every number divisible by `threshold` becomes `ABSENT_LATENESS`.
       - A day whose status changed gets `calculatedAt: now`.

     Add Spanish docblocks citing decisions 26-30.

     `lateness-rule.repository.ts`:
     - `put(rule)` inserts, or replaces the rule with the same `(companyId, effectiveFrom)`;
     - `listByCompany(companyId)` returns the rules ascending by `effectiveFrom`.

   - Observable result:
     - `latenessSegments([], '2026-11-10', '2026-11-20')` →
       `[{2026-11-01..2026-11-15, 3}, {2026-11-16..2026-11-30, 3}]`.
     - With a `WEEK` rule from 2026-11-12, `latenessSegments(rules, '2026-11-10', '2026-11-12')` →
       `[{2026-11-01..2026-11-11, 3}, {2026-11-12..2026-11-15, N}]`. Monday 2026-11-09 is before
       the rule, so its week is clipped to start on 2026-11-12.

3. **Errors**
   - Files: `apps/api/src/modules/attendance/domain/errors.ts` (modify), `packages/contracts/src/errors.ts` (modify)
   - Do:
     - Add `LatenessRuleInPastError` with code `LATENESS_RULE_IN_PAST`, imitating the other
       business errors in `domain/errors.ts`.
     - Spanish message: "La regla de retardos no puede empezar en una fecha pasada".
     - Details: `{ effectiveFrom, today }`.
     - Add the code to the catalog as 422 with an example, next to `MONTH_NOT_AVAILABLE`.
   - Observable result: `tests/error-catalog.test.ts` passes.

4. **Persistence**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/src/modules/attendance/infrastructure/lateness-rule.mapper.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-lateness-rule.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-lateness-rule.queries.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-workday.repository.ts` (modify)
   - Do: follow the `db-change` skill.
     - Add `model AttendanceLatenessRule`:
       - `companyId` uuid, with the "referencia por id a organization, sin FK (ADR 0010)"
         comment;
       - `effectiveFrom` `@db.Date`;
       - `threshold` `Int`;
       - `period` `VarChar(10)`, with a comment naming `LATENESS_PERIODS`;
       - `setAt` `Timestamptz(3)`;
       - `setBy` uuid;
       - `@@id([companyId, effectiveFrom])`, `@@map("lateness_rules")`, `@@schema("attendance")`.

       Generate the migration with `pnpm db:migrate --name create_lateness_rules`.

     - The mapper imitates `shift.mapper.ts` for `@db.Date` ↔ `YYYY-MM-DD`.
     - The repository implements `put` as an upsert and `listByCompany` ordered ascending.
     - The queries implement `listByCompany(companyId): LatenessRuleDto[]`, newest first (step 6
       defines the DTO).
     - In `PrismaWorkdayRepository`, add
       `listBetween(employeeId, from, to): Promise<Workday[]>`: the employee's rows with
       `date` in `[from, to]`, through `WorkdayMapper.toDomain`.
   - Observable result: `pnpm db:migrate` creates `attendance.lateness_rules`, and
     `pnpm db:generate` and the typecheck pass.

5. **The count inside the recalculation**
   - Files: `apps/api/src/modules/attendance/domain/workday.repository.ts` (modify), `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts` (modify)
   - Do:
     - Add `listBetween(employeeId, from, to): Promise<Workday[]>` to `WorkdayRepository`, with a
       docblock.
     - In `RecalculateWorkdays`, add `latenessRuleRepository: LatenessRuleRepository` to `Deps`.
     - Inside the transaction, after `calculateWorkdays`
       (`recalculate-workdays.command.ts:92-101`) and in place of the current `replaceDates`
       call:
       1. `segments = latenessSegments(await latenessRuleRepository.listByCompany(employee.companyId), input.from, input.to)`.
       2. `stored = (await workdayRepository.listBetween(employee.id, segments[0].start, segments.at(-1).end))`,
          filtered to dates not in `closedDates`.
       3. Merge `stored` and `workdays`. For each segment, take the merged jornadas whose date is
          inside it and call `applyLatenessRule(…, segment.threshold, now)`.
       4. Call `replaceDates(employee.id, [...closedDates, ...stored dates], adjusted)` once.
     - Keep the result unchanged: `recalculatedDates` and `storedWorkdays` still count only the
       recalculated range.
     - Add a Spanish comment explaining why the whole segment is recounted: decision 27, and
       that a removed retardo must undo a falta.
   - Observable result:
     - With N=3 per fortnight and retardos on 3, 4 and 5 November, recalculating November 1-10
       stores 5 November as `ABSENT_LATENESS`.
     - Recalculating only 3 November after making it on time stores 5 November back as
       `ATTENDED`.

6. **Set and list the rule**
   - Files: `packages/contracts/src/attendance/lateness-rule.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/src/attendance/workday.contract.ts` (modify), `apps/api/src/modules/attendance/application/commands/set-lateness-rule.command.ts` (create), `apps/api/src/modules/attendance/application/queries/lateness-rule.queries.ts` (create), `apps/api/src/modules/attendance/application/queries/list-lateness-rules.query.ts` (create)
   - Do:
     - **Contract** (imitate `shift.contract.ts:177-215`):
       - `SetLatenessRuleSchema { threshold: z.int().min(1).max(MAX_LATENESS_THRESHOLD), period: z.enum(LATENESS_PERIODS) }`.
       - `LatenessRuleSchema { effectiveFrom, threshold, period, setAt }`.
       - `LatenessRulesSchema { items: LatenessRuleSchema[], default: { threshold, period } }`.
       - Route `setLatenessRule`: `PUT /companies/:companyId/attendance/lateness-rules/:effectiveFrom`
         with `requires('attendance.shifts:manage', { companyParam: 'companyId' })`, 204, and
         errors `COMPANY_NOT_FOUND`, `LATENESS_RULE_IN_PAST`.
       - Route `listLatenessRules`: `GET /companies/:companyId/attendance/lateness-rules` with
         `attendance.shifts:read`, and errors `COMPANY_NOT_FOUND`.
       - Spanish descriptions in the `**Quién puede:** / **Necesita:**` format, explaining:
         - the default of 3 per fortnight;
         - that `effectiveFrom` cannot be in the past;
         - that a period is cut at a rule change.
       - Register the routes in `index.ts` like the other attendance route groups.
       - In `workday.contract.ts`, add `` `ABSENT_LATENESS` = falta por acumular N retardos en el periodo (conserva sus minutos de retardo); `` to the status description.
     - **`SetLatenessRule`**:
       1. Check that the company exists through `shiftCompanyDirectory`, as
          `create-shift.command.ts:31-32` does.
       2. If `effectiveFrom < utcDate(clock.now())` (`domain/workday-recalculation.ts:13`),
          return `LatenessRuleInPastError`.
       3. Call `put({ ..., setAt: now, setBy })`.

       Add a docblock: no recalculation is enqueued, because no stored day can be in a period of
       the new rule.

     - **Query**: port `LatenessRuleQueries.listByCompany`. `ListLatenessRules` checks the
       company exists and returns `{ items, default: DEFAULT_LATENESS_RULE }`.
   - Observable result: the contract tests compile, and `pnpm --filter @rrhh/contracts openapi`
     regenerates `openapi.json` (step 7).

7. **Wiring**
   - Files: `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-lateness-rule.store.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-workday.store.ts` (modify), `apps/api/tests/test-app.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify), `docs/harness/modules.json` (modify)
   - Do:
     - **Router:** bind both routes like `assignEmployeeShift`
       (`attendance.router.ts:113-122`), with `setBy: requireActor(ctx).userId`.
     - **Module:** register `latenessRuleRepository`, `latenessRuleQueries`, `setLatenessRule` and
       `listLatenessRules`, and pass the two use cases to the router.
     - **In-memory store:** create `InMemoryLatenessRuleStore`, holding the repository and the
       queries over one map, as `in-memory-shift.store.ts` does. Add `listBetween` to
       `InMemoryWorkdayRepository`.
     - **`test-app.ts`:** register the in-memory lateness adapters next to lines 179-183. Only
       add lines.
     - **OpenAPI:** regenerate `openapi.json`, and raise the route count in `openapi.test.ts` by 2.
     - **`modules.json`:** append "regla N retardos = 1 falta por empresa" to the attendance
       summary.
   - Observable result: `pnpm check` passes, including `tests/container.test.ts`.

8. **Mobile shows the new status**
   - Files: `apps/mobile/src/features/attendance/format.ts` (modify)
   - Do:
     - In `workdayStatusView`, add
       `case 'ABSENT_LATENESS': return { label: 'Falta', tone: 'danger', detail: 'Por retardos' };`.
     - In `monthSummary`, count `ABSENT_LATENESS` as `absences += 1` and `late += 1`.
     - Update the summary docblock: a falta por retardos also counts as a retardo.
   - Observable result: `pnpm --filter @rrhh/mobile typecheck` passes.

## Acceptance criteria

- [ ] `pnpm check` and `pnpm test:integration` pass. The migration creates
      `attendance.lateness_rules` and no other table changes.
- [ ] `PUT /companies/:id/attendance/lateness-rules/<today or later>` with `{threshold, period}`
      returns 204, and the `GET` lists it with `default: {threshold: 3, period: 'FORTNIGHT'}`.
      Repeating the same date replaces the rule.
- [ ] Setting a rule with a past date gives 422 `LATENESS_RULE_IN_PAST`. A `threshold` of 0 or
      32, or an unknown `period`, gives 400 `VALIDATION_ERROR`. Another company's id gives 403
      for HR. A colaborador gets 403.
- [ ] A company with no rule, and a colaborador with 3 retardos in the same fortnight: after the
      recalculation, the 3rd day is `ABSENT_LATENESS` with its `lateMinutes`, on the staff route
      and on `GET /me/attendance/workdays`. With 7 retardos, the 3rd and 6th are.
- [ ] Retardos in different fortnights do not add up. Retardos on both sides of a rule change do
      not add up either.
- [ ] Making the 1st retardo on time (a late punch plus a recalculation of that day only) turns the
      former 3rd day back to `ATTENDED`.
- [ ] In the mobile Asistencia tab, the day shows "Falta · Por retardos", and the month summary
      counts it in Faltas and in Retardos.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                                                                              |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `latenessPeriodOf` (weeks across months, Monday start, 15/16 boundary, 28-31 day months); `latenessSegments` (default, history, clipping at a change, segment repeated once); `applyLatenessRule` (N=1, N=3 with 2/3/7 retardos, reset of old `ABSENT_LATENESS`, non-late and rest days untouched) |
| application | yes     | `RecalculateWorkdays` with the in-memory stores: conversion; undo after a retardo disappears; a range recalculation that only touches part of a segment; segments of two rules; `SetLatenessRule` (company missing, past date, same date replaces); `ListLatenessRules`                            |
| contract    | yes     | `SetLatenessRuleSchema` limits, `LatenessRulesSchema`, both routes' access and errors, the new catalog entry, `ABSENT_LATENESS` in the workday enum                                                                                                                                                |
| http        | yes     | PUT/GET status codes and shapes (HR, HOLDING_ADMIN, colaborador 403, other company 403); a falta por retardos seen through the staff workdays route and `/me/attendance/workdays` after punches by `/iclock` and a recalculation                                                                   |
| integration | yes     | `PrismaLatenessRuleRepository` (upsert, order), `PrismaLatenessRuleQueries`, `PrismaWorkdayRepository.listBetween`, and an `ABSENT_LATENESS` row round-trip                                                                                                                                        |
| e2e         | no      | (no e2e infrastructure yet). The mobile `format.ts` cases (`workdayStatusView` and `monthSummary` with `ABSENT_LATENESS`) go in its unit tests.                                                                                                                                                    |

## Deviations

Cosmetic, fixed forward (steps 1-8 otherwise done as written):

1. Step 4: the plan says `WorkdayMapper.toDomain`, but that function did not exist
   (`workday.mapper.ts` only had `toPersistence` and `toDto`). I added `toDomain` to
   `apps/api/src/modules/attendance/infrastructure/workday.mapper.ts` (not in the file list).
2. Step 5: `RecalculateWorkdays` has a new dependency and `WorkdayRepository` a new method, so two
   existing test files that build them by hand stopped compiling or failing. I added only the new
   dependency lines, no new tests:
   `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.test.ts`
   (`latenessRuleRepository` plus a `listBetween` passthrough) and
   `apps/api/tests/integration/attendance/prisma-workday-lock.int.test.ts` (`latenessRuleRepository`).
   Both are outside the plan's file list; `pnpm plans:scope` flags them.
3. The migration is `apps/api/prisma/migrations/20261111153912_create_lateness_rules/`.

## Test coverage

Baseline (before writing tests): `pnpm check` green, `pnpm test:integration` 20 files / 269 tests
green. All tests below are new files except two cases added to `apps/mobile/.../format.test.ts`
(file listed by the plan's e2e row). No GAP and no NOT CONFIRMED: every plan behavior is
implemented and was confirmed by execution.

| Behavior (plan / code)                                                                                                                                                                     | Source                                                          | Layer       | Test                                                                                                        | State                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------- | ------------------------- |
| Period WEEK Mon-Sun (across month/year), FORTNIGHT 1-15/16-end, MONTH, 28-31 day months and leap year                                                                                      | `domain/lateness-rule.ts` `latenessPeriodOf`                    | domain      | `lateness-rule.test.ts › latenessPeriodOf`                                                                  | CONFIRMED                 |
| Segments: default 3/FORTNIGHT, whole (not clipped), repeated once, clipped at a rule change (plan example), history, inclusive `effectiveFrom`                                             | `domain/lateness-rule.ts` `latenessSegments`                    | domain      | `lateness-rule.test.ts › latenessSegments`                                                                  | CONFIRMED                 |
| Count: N=1, N=3 with 2/3/7 retardos, unordered input, non-late/absent/rest days untouched, reset of old `ABSENT_LATENESS`, `calculatedAt` only on changed days, no mutation                | `domain/lateness-rule.ts` `applyLatenessRule`                   | domain      | `lateness-rule.test.ts › applyLatenessRule`                                                                 | CONFIRMED                 |
| `SetLatenessRule`: company missing, past date (details), today accepted, UTC today, same date replaces, history, per company                                                               | `set-lateness-rule.command.ts`                                  | application | `set-lateness-rule.command.test.ts`                                                                         | CONFIRMED                 |
| `ListLatenessRules`: default, newest first, per company, company missing                                                                                                                   | `list-lateness-rules.query.ts`                                  | application | `list-lateness-rules.query.test.ts`                                                                         | CONFIRMED                 |
| Recalculation: conversion with default, 7 retardos, no carry-over, fortnights apart, undo, partial segment, open day, two rules, past segment keeps old rule, result counts only the range | `recalculate-workdays.command.ts`                               | application | `recalculate-workdays-lateness.command.test.ts` (17 tests)                                                  | CONFIRMED                 |
| `SetLatenessRuleSchema` limits (0, 32, decimal, text, bad period), `LatenessRule(s)Schema`                                                                                                 | `lateness-rule.contract.ts`                                     | contract    | `lateness-rule.contract.test.ts`                                                                            | CONFIRMED                 |
| Both routes: access, method/path, 204, errors, params; catalog entry `LATENESS_RULE_IN_PAST` 422; `ABSENT_LATENESS` in the workday enum                                                    | `lateness-rule.contract.ts`, `errors.ts`, `workday.contract.ts` | contract    | `lateness-rule.contract.test.ts`                                                                            | CONFIRMED                 |
| PUT/GET: 204/200 shapes, replace, history order, 422 past, 400 validation, 404, HR other company 403, colaborador 403, 401                                                                 | `attendance.router.ts`                                          | http        | `tests/attendance-lateness-rules.test.ts`                                                                   | CONFIRMED                 |
| Falta por retardos on staff route and `/me/attendance/workdays` after `/iclock` punches + recalculation; undo; rule from today does not alter earlier days                                 | `recalculate-workdays.command.ts`, router                       | http        | `tests/attendance-lateness-rules.test.ts › una falta por retardos vista por las rutas de jornadas`          | CONFIRMED                 |
| `PrismaLatenessRuleRepository` upsert, DATE column, ascending order, per company, corrupt period fails                                                                                     | `prisma-lateness-rule.repository.ts`, `lateness-rule.mapper.ts` | integration | `integration/attendance/prisma-lateness-rule.int.test.ts`                                                   | CONFIRMED                 |
| `PrismaLatenessRuleQueries` newest first, DTO with ISO `setAt`                                                                                                                             | `prisma-lateness-rule.queries.ts`                               | integration | `integration/attendance/prisma-lateness-rule.int.test.ts`                                                   | CONFIRMED                 |
| `PrismaWorkdayRepository.listBetween` (employee scope, inclusive bounds, order, domain round trip) and `ABSENT_LATENESS` row round-trip                                                    | `prisma-workday.repository.ts`, `workday.mapper.ts`             | integration | `integration/attendance/prisma-workday-lateness.int.test.ts`                                                | CONFIRMED                 |
| Mobile `workdayStatusView` and `monthSummary` with `ABSENT_LATENESS` (falta + retardo, not attended)                                                                                       | `apps/mobile/src/features/attendance/format.ts`                 | mobile unit | `format.test.ts › ABSENT_LATENESS…`, `…cuenta como falta y también como retardo…`, `…suma sus horas extra…` | CONFIRMED                 |
| Mobile tab renders "Falta · Por retardos" on a device                                                                                                                                      | acceptance criterion                                            | e2e         | not tested: no e2e infrastructure (`testing.md`); the label text is covered at unit level only              | NOT TESTED (no e2e layer) |

## Review findings

Reviewer (2026-11-11), diff = uncommitted work over `origin/main`.

**Checklist: 13/13 passed.**

- `pnpm plans:scope … --base origin/main`: exits 1, but every flagged file is accounted for:
  `workday.mapper.ts`, `recalculate-workdays.command.test.ts` and `prisma-workday-lock.int.test.ts`
  (Deviations 1-2, checked: `toDomain` added; the two tests only gain the new dep /
  `listBetween` passthrough); the tester's new test files and `format.test.ts` (Test coverage);
  `apps/mobile/.gitignore` and `docs/referencia/` are foreign untracked files, not this plan's.
  Hot files are append-only: `schema.prisma` (one new model), `test-app.ts` (added lines only),
  `contracts/src/index.ts` (added lines), `modules.json` (summary extended, as step 7 asks).
- `pnpm check`: green (format, typecheck, lint, tests: api 116 files / 1580 tests, contracts 434,
  domain 98, mobile 131; arch, plans, harness, quality). The 2 lint warnings are in files not
  touched by this plan.
- `pnpm test:integration`: 22 files / 283 tests green.
- Business rules in `domain/` (`lateness-rule.ts`); router/mappers/UI hold none. Command returns
  `Result`; the list goes through `LatenessRuleQueries` → contract DTO; repositories have no
  screen methods (`listBetween` is used by the command). Types from `@rrhh/contracts`. Error
  `LATENESS_RULE_IN_PAST` is a `BusinessRuleViolationError` with catalog entry 422. Time via
  `Clock`. Migration `20261111153912_create_lateness_rules` only `CREATE TABLE
"attendance"."lateness_rules"` with the composite PK: no DROP, no FK. DI resolves
  (`container.test.ts` green). No secrets or real personal data. Docs: no doc describes workday
  statuses beyond the contract and `modules.json`, both updated.

**Bug hunt: segment recount in `RecalculateWorkdays`
(`recalculate-workdays.command.ts:103-136`).** Checked and found correct:

- Segments form a partition: for any date `y` in the segment of `x`, the effective rule and the
  period are the same, so `latenessSegments` covers `[first.start, last.end]` without gaps or
  overlaps. `listBetween` over that span assigns each stored day to exactly one segment, and
  `adjusted` has exactly the merged days (none dropped, none duplicated: `stored` excludes
  `closedDates`, `workdays` only has closed dates).
- Days outside the range but inside a segment are recounted and rewritten in the same
  `replaceDates`, under the employee lock and transaction; their `calculatedAt` changes only if
  their status changed. Undo works: every `ABSENT_LATENESS` goes back to `ATTENDED` before the
  numbering (it keeps `lateMinutes > 0`).
- Open days: pending dates have no row and are not counted; a stored row on a now-pending date is
  kept and recounted (before the plan it was left as is). When the day closes, the hourly sweep's
  range touches the segment and recounts it.
- Cuts at a rule change: the count is a prefix count in date order, so clipping a segment's END
  (a new rule from today or later) never changes the status of earlier days. A rule cannot start
  in the past, so no stored day moves to another segment.
- "Every stored jornada is before UTC today" holds: a date D's window ends no earlier than local
  D 20:00 (next start − 240 min, or local midnight without a shift), which is already D+1 in UTC
  for every offset ≤ UTC−4 (all Mexican zones).

**Findings: 0 Critical, 0 High, 0 Medium, 0 Low. All passed.** Informational only (no change
required, both follow the approved plan):

- Info-1 (`recalculate-workdays.command.ts:131-135`): every recalculation, including the hourly
  sweep for every colaborador, deletes and re-inserts all stored jornadas of the touched segments
  (up to ~31 rows with `MONTH`) even when no status changed. Correct, but more writes than
  necessary; passing only the stored dates whose status changed would avoid it. This is what step
  5.4 prescribes.
- Info-2 (`set-lateness-rule.command.ts:36-40`): the "not in the past" check relies on
  `PUNCH_WINDOW_MARGIN_MINUTES = 240` and on every site being at UTC−4 or further west. If the
  margin grows or a site east of that is added, a jornada of the UTC date could be stored before a
  rule from "today" is set, and its period would change without a recount. No test pins this
  assumption.

## Verification

Verifier (inline, sesión principal), 2026-11-11. Resultado: **PASS**.

- Suites: `pnpm check` (api 1580 + 5 skipped, contracts 434, domain 98, mobile 131) y
  `pnpm test:integration` (22 archivos, 283 tests) verdes en la revisión, sin cambios de código
  después. La migración `20261111153912_create_lateness_rules` está aplicada en la base de
  desarrollo y crea solo `attendance.lateness_rules`.
- App corriendo sobre la base de desarrollo:
  - API en `:3000`, con `CORS_ORIGINS` ampliado a `:8082` en la línea de comandos, porque `:8081`
    lo ocupaba otro proyecto;
  - worker;
  - Expo web en `:8082`.
- Cuenta: colaboradora Ana Rojas, con los datos de la verificación de attendance 005: turno
  "Oficina 9 a 18" con tolerancia de 10 min y un retardo de 22 min el 30-10. La empresa no tenía
  regla, así que aplicaba la de por defecto, 3 por quincena.

Criterios de aceptación:

- [x] Suites y migración, arriba.
- [x] **Regla por defecto.** Llegaron por `/iclock` marcaciones tardías el 26-10 (30 min), el
      27-10 (25 min) y el 28-10 (40 min). El worker recalculó solo, sin llamada manual, y
      `GET /me/attendance/workdays?month=2026-10` mostró:
  - el 28-10 como `ABSENT_LATENESS` con sus 40 min, por ser el 3.er retardo de la quincena 16–31;
  - el 30-10 (4.º retardo) como `ATTENDED`.
- [x] **Deshacer y mover.** Con una marcación temprana extra el 26-10 a las 08:55, el worker
      recalculó solo ese día y recontó la quincena entera:
  - el 26-10 quedó sin retardo;
  - el 28-10 volvió a `ATTENDED`;
  - el 30-10, que ahora es el 3.er retardo, pasó a `ABSENT_LATENESS`.
- [x] **Fijar y listar la regla**, con los casos de uso reales `setLatenessRule` y
      `listLatenessRules`, desde un script temporal fuera del repo:
  - sin regla, la lista devuelve `items: []` y `default: {threshold: 3, period: 'FORTNIGHT'}`;
  - con fecha 2026-11-10 (pasada) devuelve `LATENESS_RULE_IN_PAST` con
    `{effectiveFrom, today: 2026-11-11}`;
  - con 2026-11-12, primero `WEEK/2` y luego `MONTH/4` en la misma fecha, se reemplaza: la lista
    deja una sola regla `{2026-11-12, 4, MONTH}`.
- [x] **Acceso por HTTP:** con el token de Ana, GET y PUT de `.../attendance/lateness-rules` dan
      403; sin sesión, 401. Los PUT/GET de RRHH y admin, el 400 de validación y el 403 de RRHH de
      otra empresa no se ejercitaron en vivo, porque las contraseñas de staff viven en `.env`, que no
      se lee. Los cubren los 24 tests http.
- [x] **App móvil.** Asistencia, "Mes anterior", Octubre 2026:
  - el 30-10 se ve como "Falta · Por retardos · 09:22–18:00";
  - el 27 y el 28 como "Retardo 25 min" y "Retardo 40 min";
  - el resumen da 4 asistencias, 3 retardos (incluye el día convertido), 18 faltas (17 sin
    marcaciones y 1 por retardos) y 12 min extra, y cuadra con la lista.
- Datos que quedan en la base de desarrollo:
  - 7 marcaciones de Ana (26 al 28-10);
  - la regla de la empresa holding `MONTH`, N=4, desde 2026-11-12.
