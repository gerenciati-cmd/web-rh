---
status: review
module: attendance
min_implementer: high
depends_on: ['002']
---

# 003 — Automatic recalculation

## Context

**Today.** Plan 002 (`done`) recalculates a colaborador's jornadas only when HR calls
`RecalculateWorkdays` for a range (`apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts:59-119`).
Its writes are `replaceDates` = delete + insert in one transaction
(`apps/api/src/modules/attendance/infrastructure/prisma-workday.repository.ts:11-27`), so two
concurrent recalculations of the same colaborador can collide on the primary key (002 review
Low-2, carried here by the README's plan 003 row). Nothing recalculates on its own:

- Punches are saved by `RecordDevicePush` (`apps/api/src/modules/attendance/application/commands/record-device-push.command.ts:75-117`;
  `saveNew` returns only a count, `apps/api/src/modules/attendance/domain/punch.repository.ts:3-9`).
- Assignments are written by `AssignEmployeeShift`
  (`apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.ts:39-60`).
- A termination publishes `EMPLOYEE_TERMINATED` with `{ employeeId, terminationDate }`
  (`apps/api/src/modules/employees/domain/employee.ts:151`); attendance already subscribes to it
  for the device sync (`apps/api/src/modules/attendance/attendance.module.ts`, `subscribe`).
- Jobs exist but only one-off: the `JobQueue` port (`apps/api/src/shared/application/jobs.ts:5-21`),
  `BullMqJobQueue` (`apps/api/src/infrastructure/queue/bullmq-job-queue.ts:7-32`), handlers
  declared per module (`apps/api/src/shared/app-module.ts:30-31`, e.g.
  `apps/api/src/modules/identity/identity.module.ts:196-199`) and run by the worker
  (`apps/api/src/main/worker.ts:19-33`). There is no recurring job; BullMQ 6.3.9 offers
  `Queue.upsertJobScheduler(id, { pattern, tz }, { name, data })`
  (`apps/api/node_modules/bullmq/dist/esm/classes/queue.d.ts:205-209`,
  `.../interfaces/repeat-options.d.ts:18,61`).
- `TransactionRunner` runs work in one transaction that repositories join
  (`apps/api/src/shared/application/ports.ts:25-32`, `apps/api/src/infrastructure/database/prisma-database.ts:29-33`).

**Need.** README decisions 19–22: recalculate automatically when punches arrive, when an
assignment changes and when a colaborador is terminated, and close days hourly so faltas appear
without anyone asking; serialize recalculations per colaborador.

**Approach.** Every trigger only **enqueues** a job `attendance.recalculate-workdays` for one
colaborador and a range; the worker runs it through the existing `RecalculateWorkdays`. The
command now runs inside a transaction that first takes a Postgres advisory lock on the
colaborador (`pg_advisory_xact_lock`), so concurrent jobs or a manual call wait instead of
colliding. A recurring scheduler (new ADR 0016) fires `attendance.close-workdays` every hour; its
handler enqueues one recalculation per colaborador with an assignment. Compared with (a)
recalculating synchronously inside the `/iclock` request — slows the device protocol and fails
the push on a calculation error — and (b) a per-colaborador BullMQ queue/group for ordering —
not available in open-source BullMQ 6 and still racy with the manual endpoint — enqueue + DB lock
is the smallest correct option.

**Ranges (decision 20).** Every automatic range is clamped to `[today − 61, today]` (62 dates,
`MAX_WORKDAY_RANGE_DAYS`) with `today` = the UTC date of `clock.now()`; a range that ends before
the clamp is skipped. Open dates inside it are simply reported pending by 002.

- Punches: per PIN in a push with at least one new punch, `from` = UTC date of its earliest punch
  − 1 (a night shift's exit belongs to the day before; Mexico is behind UTC) and `to` = UTC date
  of its latest. When the batch also carried duplicates, the whole batch's range is used (the
  repository does not say which lines were new; accepted).
- Assignment: `from` = `effectiveFrom`, `to` = today (skipped when `effectiveFrom` is in the
  future: the sweep picks it up when it arrives).
- Termination: `from` = `terminationDate`, `to` = today (deletes rows after the termination).
- Sweep (decision 21): every hour at minute 5, `from` = today − 2, `to` = today, for every
  colaborador with at least one assignment, skipping terminated ones whose termination date is
  before `from`.

**Architect's choices (confirm on approval).**

- An **RFC change does not trigger** a recalculation: punches are matched by the current RFC
  (002 accepted limitation), so recalculating would turn the colaborador's past attended days
  into faltas. The sweep only touches the last 3 dates.
- A job whose colaborador cannot be recalculated (not found, no RFC, no sede, terminated without
  a date) logs a warning and **completes** (no retry): retrying cannot fix it.
- Schedulers are declared by modules (`AppModule.schedules`) and **upserted by the worker at
  start-up**, like handlers are collected today; the API process never schedules. In
  development the worker must run (`pnpm --filter @rrhh/api dev:worker`) for triggers to take
  effect; the manual endpoint of 002 still works without it.

**Imitated files.** Job handler: `apps/api/src/modules/identity/application/jobs/send-invitation-email.job.ts:1-49`.
Enqueue from a command: `apps/api/src/modules/identity/application/commands/invite-employee.command.ts:129`.
Event subscription with payload guard: `apps/api/src/modules/attendance/attendance.module.ts`
(`payloadId` and `subscribe`). Test double: `RecordingJobQueue`
(`apps/api/src/shared/testing/fakes.ts:49-57`). ADR format: `docs/adr/0000-plantilla.md`.

## Out of scope

- Company-wide or bulk recalculation endpoints (decision 22).
- Recalculating on RFC or sede changes (see Architect's choices).
- Transactional outbox / durable events (ADR 0005 unchanged): a crash between saving punches and
  enqueueing loses that trigger; the hourly sweep repairs the last 3 dates.
- Deduplicating or coalescing enqueued jobs; per-company time zones for the sweep schedule.
- Period closing/locking; the N-retardos rule (plan 004); web and mobile screens.
- The `complexity` lint warning in `workday-calculator.ts` (002 review Observation A).

## Dependencies

- `002` (done): `RecalculateWorkdays` (`{ companyId, employeeId, from, to }` →
  `Result<WorkdayRecalculationDto>`), `WorkdayEmployeeDirectory`, `WorkdayRepository.replaceDates`,
  `MAX_WORKDAY_RANGE_DAYS`, `addDays` / `daysBetween` in `domain/local-date.ts`.

## Steps

1. **Recurring jobs in the platform (ADR 0016)**
   - Files: `docs/adr/0016-jobs-programados.md` (create), `docs/adr/README.md` (modify), `apps/api/src/shared/application/jobs.ts` (modify), `apps/api/src/shared/app-module.ts` (modify), `apps/api/src/infrastructure/queue/bullmq-job-queue.ts` (modify), `apps/api/src/container.ts` (modify), `apps/api/src/main/worker.ts` (modify)
   - Do:
     - ADR 0016 "Jobs programados declarados por módulo" (Spanish, template format, status
       Aceptado, 2026-10-14): context (cierre de jornadas, no recurring jobs), decision (BullMQ
       job schedulers; modules declare `schedules`; the worker upserts them at start-up with a
       stable id = job name; handlers stay ordinary `JobHandler`s), alternatives (node-cron in the
       API process — runs once per API replica; an external cron calling an endpoint — another
       moving part and an authenticated machine route), consequences (the worker must run; a
       removed schedule must be removed explicitly with `removeJobScheduler`). Add its row to the
       ADR README table.
     - `jobs.ts`: add `export interface ScheduledJob { name: string; pattern: string; timeZone:
string }` (docblock: cron pattern, IANA zone) and `export interface JobScheduler {
upsert(job: ScheduledJob): Promise<void> }`.
     - `app-module.ts`: add `readonly schedules?: readonly ScheduledJob[];` after `jobs`, with
       a docblock citing ADR 0016.
     - `BullMqJobQueue` implements `JobScheduler`: `upsert` calls
       `this.queue.upsertJobScheduler(job.name, { pattern: job.pattern, tz: job.timeZone },
{ name: job.name, data: {} })`.
     - `container.ts`: `SharedCradle` gains `jobScheduler: JobScheduler`, registered as its own
       instance next to `jobQueue` (`container.ts:84-86`):
       `jobScheduler: asClass(BullMqJobQueue).singleton().disposer((queue) => queue.close())`
       (no cast from `jobQueue`; a second lazy Queue connection is acceptable).
     - `worker.ts`: after collecting handlers, `for (const module of modules) for (const job of
module.schedules ?? []) await container.cradle.jobScheduler.upsert(job)`, then log
       `{ schedules: [...] }` in the `worker listo` line.
   - Observable result: `pnpm check` passes; `tests/container.test.ts` resolves `jobScheduler`
     without Valkey (the queue connects lazily, `bullmq-job-queue.ts:12-16`).

2. **Domain: automatic ranges**
   - Files: `apps/api/src/modules/attendance/domain/workday-recalculation.ts` (create), `apps/api/src/modules/attendance/domain/workday.repository.ts` (modify), `apps/api/src/modules/attendance/domain/shift-assignment.repository.ts` (modify)
   - Do:
     - `workday-recalculation.ts` (docblock citing decisions 19–21): `SWEEP_DAYS = 3`;
       `utcDate(instant: Date): string` (`toISOString().slice(0, 10)`);
       `automaticRange(from: string, to: string, today: string): { from: string; to: string } | null`
       = `from' = max(from, addDays(today, −(MAX_WORKDAY_RANGE_DAYS − 1)))`, `to' = min(to,
today)`, `null` when `from' > to'`; `sweepRange(today)` = `{ from: addDays(today, −(SWEEP_DAYS − 1)), to: today }`.
     - `WorkdayRepository`: add `lockEmployee(employeeId: string): Promise<void>` — "takes a
       lock held until the surrounding transaction ends; concurrent recalculations of the same
       colaborador wait".
     - `ShiftAssignmentRepository`: add `listAssignedEmployees(): Promise<{ employeeId: string;
companyId: string }[]>` — distinct colaboradores with at least one assignment.
   - Observable result: `pnpm typecheck` passes.

3. **Serialized recalculation**
   - Files: `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/recalculate-workdays.command.test.ts` (modify)
   - Do: add `transactionRunner: TransactionRunner` to `Deps`. Keep the validations before the
     transaction (lines 72-93 unchanged); wrap from `buildCalendar` to `replaceDates`
     (lines 95-112) in `transactionRunner.run(async () => { await
workdayRepository.lockEmployee(employee.id); … })`, returning the same result. Docblock: why
     (002 review Low-2). In the test file, pass a pass-through `transactionRunner`
     (`{ run: (work) => work() }`) to the constructor (mechanical).
   - Observable result: existing recalculation tests pass unchanged.

4. **Jobs and triggers**
   - Files: `apps/api/src/modules/attendance/application/jobs/recalculate-workdays.job.ts` (create), `apps/api/src/modules/attendance/application/jobs/close-workdays.job.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-employee-shift.command.test.ts` (modify)
   - Do:
     - `recalculate-workdays.job.ts`: `RECALCULATE_WORKDAYS = 'attendance.recalculate-workdays'`;
       data `{ employeeId?: string; pin?: string; from: string; to: string }` (exactly one of
       `employeeId` / `pin`); `enqueueWorkdayRecalculation(jobQueue, target, from, to, today)`
       applies `automaticRange` and enqueues only when it is not null. Handler
       `RecalculateWorkdaysJob` (deps `recalculateWorkdays`, `workdayEmployeeDirectory`,
       `punchOwnerDirectory`, `logger`): resolve the colaborador (`pin` → `ownersOf([pin])`,
       unknown PIN → debug log and return; `employeeId` → `workdayEmployeeDirectory.find`,
       missing → warn and return), call `recalculateWorkdays.execute({ companyId, employeeId,
from, to })`; on `err` log warn `{ employeeId, code }` "asistencia: recálculo omitido" and
       return; on `ok` log info with the counts. Unexpected exceptions propagate (BullMQ retries).
     - `close-workdays.job.ts`: `CLOSE_WORKDAYS = 'attendance.close-workdays'`,
       `CLOSE_WORKDAYS_SCHEDULE: ScheduledJob = { name: CLOSE_WORKDAYS, pattern: '5 * * * *',
timeZone: 'America/Cancun' }`. Handler `CloseWorkdaysJob` (deps
       `shiftAssignmentRepository`, `workdayEmployeeDirectory`, `jobQueue`, `clock`, `logger`):
       for each `listAssignedEmployees()`, skip a colaborador whose directory entry is missing or
       whose `terminationDate` is before `sweepRange(today).from`; enqueue
       `RECALCULATE_WORKDAYS` with `employeeId` and the sweep range; log info `{ enqueued }`.
     - `RecordDevicePush`: add `jobQueue` to `Deps`; after `saveNew`, when `inserted > 0`, group
       the valid punches by PIN and call `enqueueWorkdayRecalculation` per PIN with
       `from = addDays(utcDate(min), −1)`, `to = utcDate(max)`. An enqueue failure is logged
       (error) and does not fail the push: the device must not resend.
     - `AssignEmployeeShift`: add `jobQueue` to `Deps`; after `put`, call
       `enqueueWorkdayRecalculation` with `employeeId`, `from = effectiveFrom`, `to = today`.
     - Tests listed above: add `jobQueue: new RecordingJobQueue()` to each constructor
       (mechanical; new behaviour is the tester's).
   - Observable result: `pnpm typecheck` and the existing tests pass.

5. **Persistence and in-memory adapters**
   - Files: `apps/api/src/modules/attendance/infrastructure/prisma-workday.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-shift-assignment.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-workday.store.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-shift.store.ts` (modify)
   - Do:
     - `PrismaWorkdayRepository.lockEmployee`: `await this.deps.database.client.$queryRaw\`SELECT
       pg_advisory_xact_lock(hashtextextended(${employeeId}, 0))\``; comment: transaction-scoped,
       released at commit/rollback; outside a transaction it would be released at once.
     - `PrismaShiftAssignmentRepository.listAssignedEmployees`: `findMany({ distinct:
['employeeId'], select: { employeeId: true, companyId: true } })`.
     - In-memory: `lockEmployee` resolves immediately (single-threaded tests);
       `listAssignedEmployees` from the store, distinct by `employeeId`.
   - Observable result: `pnpm typecheck` passes.

6. **Module wiring**
   - Files: `apps/api/src/modules/attendance/attendance.module.ts` (modify)
   - Do: register `recalculateWorkdaysJob` and `closeWorkdaysJob` (cradle + registrations);
     `jobs: ({ recalculateWorkdaysJob, closeWorkdaysJob }) => [recalculateWorkdaysJob,
closeWorkdaysJob]`; `schedules: [CLOSE_WORKDAYS_SCHEDULE]`; in `subscribe`, add an
     `EMPLOYEE_TERMINATED` handler (keep the existing sync handler) that reads `employeeId` with
     `payloadId` and `terminationDate` (a `Date`; throw like `payloadId` when it is not) and
     calls `enqueueWorkdayRecalculation(jobQueue, { employeeId }, utcDate(terminationDate),
today, today)` — add `jobQueue` and `clock` to the destructured cradle.
   - Observable result: `pnpm check` passes, including `tests/container.test.ts`.

7. **Docs**
   - Files: `docs/harness/modules.json` (modify), `docs/architecture.md` (modify)
   - Do: attendance summary: "…recalculated on demand, on new punches/assignments/terminations and
     hourly (ADR 0016)."; in `docs/architecture.md`, next to the worker description, one sentence
     that modules can declare recurring jobs that the worker schedules (ADR 0016).
   - Observable result: `pnpm check` passes.

8. **Tests phase files and Deviation 1** (added by the main session before review, as the
   Low-1 of plans 001 and 002)
   - Files: `apps/api/src/modules/attendance/domain/workday-recalculation.test.ts` (create), `apps/api/src/modules/attendance/application/jobs/recalculate-workdays.job.test.ts` (create), `apps/api/src/modules/attendance/application/jobs/close-workdays.job.test.ts` (create), `apps/api/tests/attendance-recalculation.test.ts` (create), `apps/api/tests/integration/attendance/prisma-workday-lock.int.test.ts` (create), `apps/api/tests/integration/attendance/prisma-workday.int.test.ts` (modify), `apps/api/tests/attendance-clock-offset.test.ts` (modify), `apps/api/tests/attendance-device-network.test.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify), `apps/api/src/infrastructure/queue/bullmq-job-queue.test.ts` (create)
   - Do: the tester's files (see Test coverage) and the mechanical `jobQueue` argument of
     Deviation 1.
   - Observable result: `pnpm plans:scope … --base origin/main` lists no file out of scope.

## Acceptance criteria

With the API **and the worker** running against the dev database:

- [ ] Worker start-up logs `worker listo` with `attendance.close-workdays` among the schedules,
      and Valkey holds a job scheduler `attendance.close-workdays` (pattern `5 * * * *`, tz
      `America/Cancun`).
- [ ] Pushing an ATTLOG line for a colaborador with a shift (PIN = RFC) enqueues
      `attendance.recalculate-workdays`, and shortly after `GET …/workdays` shows the day
      recalculated with that punch, without calling the recalculation endpoint.
- [ ] Re-sending the same lines (all duplicates) enqueues nothing.
- [ ] Assigning a shift from a past date recalculates from that date (at most 62 days back);
      a future date enqueues nothing.
- [ ] Terminating a colaborador deletes stored rows after the termination date.
- [ ] Running the `attendance.close-workdays` handler enqueues one recalculation per assigned,
      non-ended colaborador for today − 2 … today, and faltas appear for a day without punches
      once its window closes.
- [ ] Two recalculations of the same colaborador and range sent at the same time both answer
      200 (the second waits for the first); stored rows are the same as after one.
- [ ] A recalculation job for a colaborador without RFC completes with a warning log and no retry.
- [ ] `pnpm check` and `pnpm test:integration` pass.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `automaticRange` clamps (62-day floor, future `to`, empty range), `sweepRange`, `utcDate`.                                                                                                                                                                                                                                                                                                                                                           |
| application | yes     | `RecalculateWorkdaysJob` (pin and employeeId targets, unknown PIN, `err` → warn without throwing, exception propagates); `CloseWorkdaysJob` (skips ended and missing colaboradores, one job each); `RecordDevicePush` enqueues per PIN only when something was inserted and never fails the push on an enqueue error; `AssignEmployeeShift` enqueues (and not for a future date); `RecalculateWorkdays` runs inside the transaction and locks first. |
| contract    | no      | No contract change.                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| http        | yes     | On the real container with `RecordingJobQueue`: a pushed punch, an assignment and a termination enqueue the right job and range; running the recorded job through the handler updates `GET …/workdays`.                                                                                                                                                                                                                                              |
| integration | yes     | `lockEmployee` really serializes two concurrent `RecalculateWorkdays`/`replaceDates` on the same colaborador against `rrhh_test` (no P2002, final rows correct); `listAssignedEmployees` distinct.                                                                                                                                                                                                                                                   |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                                                                                                                                                                                                                                          |

## Deviations

Implementer, 2026-10-14. All 7 steps done. Citations spot-checked (`jobs.ts:5-21`, `container.ts:84-86`,
`worker.ts:19-33`, `recalculate-workdays.command.ts:72-112`, `prisma-workday.repository.ts:11-27`,
`employee.ts:151`, `fakes.ts:49-57`): match. All deviations are cosmetic (fixed forward):

1. **Step 4 — three more test files needed the mechanical `jobQueue` constructor arg.** The plan
   lists the in-module tests, but `RecordDevicePush` is also built by hand in
   `apps/api/tests/zkteco-adms.test.ts`, `apps/api/tests/attendance-device-network.test.ts` and
   `apps/api/tests/attendance-clock-offset.test.ts`. Without it typecheck fails. Same edit as the
   planned ones (`jobQueue: new RecordingJobQueue()` + import); no behaviour change.
2. **Step 3 — the test's hand-written `WorkdayRepository` fake** in
   `recalculate-workdays.command.test.ts` needed `lockEmployee` too (delegates to the in-memory
   one). Same file the plan already lists.
3. **Step 6 — `AppModule.subscribe` cradle type widened** (`apps/api/src/shared/app-module.ts`,
   already in step 1's list) from `TCradle & { eventBus }` to `TCradle & { eventBus, jobQueue,
clock }`: `jobQueue` and `clock` live in `SharedCradle`, not in `AttendanceCradle`, so the
   destructuring the plan asks for did not type-check. Runtime is unchanged
   (`wireSubscriptions` already passes the full container cradle).
4. **Step 5 — `lockEmployee` uses `$executeRaw` instead of `$queryRaw`**, and casts the parameter
   (`${employeeId}::text`). `pg_advisory_xact_lock` returns `void`, which a raw query would have to
   deserialize; `$executeRaw` only returns the row count. Same SQL and semantics. Not yet exercised
   against Postgres (the integration test is the tester's, per the plan's test layers).
5. **Step 4 — `RecordDevicePush`:** the "only when `inserted > 0`" check lives inside the new
   private `enqueueRecalculations` (it receives `inserted`) instead of in `execute`, to keep
   `execute` under the `complexity` lint limit. Same behaviour.
6. **Step 4 — `RecalculateWorkdaysJob`** also handles a payload with neither `employeeId` nor `pin`
   (warn + return) so the handler never calls the command without a target; the plan says the
   data carries exactly one.
7. **Lint warning kept:** `enqueueWorkdayRecalculation(jobQueue, target, from, to, today)` has 5
   params (`max-params` warning, max 4). The signature is the plan's; left as specified.

## Test coverage

Tester, 2026-10-14. Baseline: `pnpm check` and `pnpm test:integration` (261 tests) green. Closing:
`pnpm check` green, `pnpm test:integration` 20 files / 269 tests green. No GAP and no NOT CONFIRMED
among the layers below; the NOT CONFIRMED items are listed at the end. Lint keeps only the two
pre-existing/specified warnings (`max-params` on `enqueueWorkdayRecalculation`, Deviation 7;
`complexity` in `workday-calculator.ts`, out of scope).

| Behavior                                                                                                                                                            | Source                                             | Layer                  | Test                                                                                                               | State                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `utcDate` is the UTC date, not local                                                                                                                                | `workday-recalculation.ts:13`                      | domain                 | `workday-recalculation.test.ts › utcDate`                                                                          | CONFIRMED                                                               |
| `automaticRange` clamps to `[today−61, today]` (62 dates), keeps inner ranges, null when empty/inverted                                                             | `workday-recalculation.ts:22-32`                   | domain                 | `workday-recalculation.test.ts › automaticRange` (8 tests)                                                         | CONFIRMED                                                               |
| `sweepRange` = last 3 dates, across month/year                                                                                                                      | `workday-recalculation.ts:35-37`                   | domain                 | `workday-recalculation.test.ts › sweepRange`                                                                       | CONFIRMED                                                               |
| `enqueueWorkdayRecalculation` enqueues clamped range for employeeId or pin, nothing when empty                                                                      | `recalculate-workdays.job.ts:23-35`                | application            | `recalculate-workdays.job.test.ts › enqueueWorkdayRecalculation`                                                   | CONFIRMED                                                               |
| `RecalculateWorkdaysJob`: employeeId / pin targets, unknown PIN (debug), missing employee (warn)                                                                    | `recalculate-workdays.job.ts:56-110`               | application            | `recalculate-workdays.job.test.ts › RecalculateWorkdaysJob`                                                        | CONFIRMED                                                               |
| `err` from the command → warn `{employeeId, code}` and completes; unexpected exception propagates                                                                   | `recalculate-workdays.job.ts:66-73`                | application            | same file (`un err del caso de uso…`, `una excepción inesperada…`)                                                 | CONFIRMED                                                               |
| `CloseWorkdaysJob`: one job per assigned employee, sweep range, skips ended-before-range and missing                                                                | `close-workdays.job.ts:40-52`                      | application            | `close-workdays.job.test.ts` (6 tests)                                                                             | CONFIRMED                                                               |
| `RecordDevicePush` enqueues per PIN (first−1 … last), only when something was inserted                                                                              | `record-device-push.command.ts:118-150`            | application            | `record-device-push.command.test.ts › recálculo automático` (duplicates, mixed batch, rejected, non-ATTLOG, floor) | CONFIRMED                                                               |
| An enqueue error is logged and never fails the push; other PINs still enqueue                                                                                       | `record-device-push.command.ts:151-157`            | application            | `… › si encolar falla, el envío se acepta igual…`                                                                  | CONFIRMED                                                               |
| `AssignEmployeeShift` enqueues effectiveFrom…today; not for future dates; clamped; not on errors                                                                    | `assign-employee-shift.command.ts:57-66`           | application            | `assign-employee-shift.command.test.ts › recálculo automático` (+ SHIFT_NOT_FOUND case)                            | CONFIRMED                                                               |
| `RecalculateWorkdays` runs in the transaction, locks before writing, validations outside, closes on throw                                                           | `recalculate-workdays.command.ts:97-124`           | application            | `recalculate-workdays.command.test.ts › serialización por colaborador` (3 tests)                                   | CONFIRMED                                                               |
| Punch, assignment, termination enqueue the right job and the job updates `GET …/workdays`                                                                           | `attendance.module.ts` (subscribe), commands above | http                   | `tests/attendance-recalculation.test.ts` (marcaciones, asignación, baja)                                           | CONFIRMED                                                               |
| Hourly close enqueues per assigned colaborador, faltas appear after running jobs; ended skipped                                                                     | `close-workdays.job.ts`                            | http                   | `… › cierre horario`                                                                                               | CONFIRMED                                                               |
| Job for a colaborador without RFC completes without throwing and stores nothing                                                                                     | `recalculate-workdays.job.ts:66-73`                | http                   | `… › colaborador que no se puede recalcular`                                                                       | CONFIRMED                                                               |
| Module declares both handlers and the schedule (name matches a handler); `jobScheduler` resolves in DI                                                              | `attendance.module.ts`, `container.ts`             | http                   | `… › declaración del módulo`; `tests/container.test.ts` (existing, resolves every registration)                    | CONFIRMED                                                               |
| `lockEmployee` really serializes two same-colaborador transactions on Postgres (B waits in `pg_locks`)                                                              | `prisma-workday.repository.ts:29-35`               | integration            | `prisma-workday-lock.int.test.ts › un segundo recálculo… espera…`                                                  | CONFIRMED                                                               |
| Lock is per colaborador (another one is not blocked) and is released on rollback                                                                                    | same                                               | integration            | same file (2 tests)                                                                                                | CONFIRMED                                                               |
| Control: without the lock two concurrent `replaceDates` of one date hit the unique constraint; with it both finish and the last wins                                | `prisma-workday.repository.ts:11-27`               | integration            | same file (`control: sin el candado…`, `con el candado la misma carrera se serializa…`)                            | CONFIRMED                                                               |
| Real `RecalculateWorkdays` x5 concurrent over Prisma repos: all ok, same 7 rows as a single run                                                                     | `recalculate-workdays.command.ts`                  | integration            | same file › `RecalculateWorkdays concurrente contra Postgres`                                                      | CONFIRMED                                                               |
| `listAssignedEmployees` is distinct per employee and carries `companyId`; empty when none                                                                           | `prisma-shift-assignment.repository.ts:44-49`      | integration            | `prisma-workday.int.test.ts › listAssignedEmployees`                                                               | CONFIRMED                                                               |
| `BullMqJobQueue.upsert` creates a job scheduler in Valkey; worker start-up logs and upserts schedules                                                               | `bullmq-job-queue.ts`, `worker.ts`                 | -                      | none                                                                                                               | NOT CONFIRMED (needs Valkey and a running worker; left to the verifier) |
| `BullMqJobQueue.upsert` passes `removeOnComplete/removeOnFail` caps with `pattern`/`tz`, id = job name; `enqueue` same caps, `true` when `sensitive` (Low-1 repair) | `bullmq-job-queue.ts:22-48`                        | unit (mocked `bullmq`) | `bullmq-job-queue.test.ts` (4 tests, incl. lazy connection)                                                        | CONFIRMED                                                               |

Repair round (Low-1), tester: `bullmq-job-queue.test.ts` 4 tests green with `Queue` mocked (no
Valkey). The real scheduler upsert in Valkey and worker start-up stay NOT CONFIRMED (verifier).

Deviation 4 (`$executeRaw` with `pg_advisory_xact_lock`) is now confirmed against `rrhh_test`: the
lock works, B shows up as an ungranted advisory lock in `pg_locks` until A ends. Tests per layer
added: domain 11, application 35 (recalculate job and enqueue helper 12, close 6, push 9, assign 5,
recalculate 3), http 12, integration 8 (6 lock + 2 distinct). Two items stay NOT CONFIRMED: the
Valkey scheduler upsert and the worker start-up log (need Valkey and a running worker), and the
decision that an RFC change does not trigger a recalculation (absence of code, nothing to assert).

## Review findings

Reviewed 2026-10-14 (reviewer subagent). Diff `origin/main...HEAD` on
`feat/attendance-recalculo-automatico` (commits `82d6f06` feat, `84f9467` tests), clean worktree.

**Checklist: 13/13 passed.**

- [x] `pnpm plans:scope … --base origin/main`: 37 changed, all in scope. Hot files are
      append-only: `container.ts` widens one type import, adds the `jobScheduler` field to
      `SharedCradle` and one registration. `modules.json` changes only the attendance summary
      sentence that step 7 asks for.
- [x] `pnpm check` green: 19/19 turbo tasks, plus format, arch, plans, harness, hooks, bootstrap
      and quality. Lint has 2 warnings and both are declared: `max-params` (Deviation 7) and
      `complexity` in `workday-calculator.ts` (out of scope).
- [x] `pnpm test:integration`: 20 files, 269 tests passed against `rrhh_test`.
- [x] Business rules: range clamping and the sweep window are in
      `domain/workday-recalculation.ts`. The jobs and the trigger code only orchestrate: they
      resolve the target, pick the per-PIN min/max and skip ended colaboradores, as the plan
      specifies.
- [x] CQRS-lite: `RecalculateWorkdays` still returns `Result` and writes through
      `WorkdayRepository`. `lockEmployee` and `listAssignedEmployees` feed commands and jobs;
      neither is a screen method.
- [x] No contract change. No hand-written request or response types.
- [x] Errors: the job logs the stable `code` of an `err` and completes. Exceptions propagate to
      BullMQ, where `attempts: 3` applies (`bullmq-job-queue.ts:24-31`).
- [x] Dates: the trigger code uses UTC dates from `Clock` (`utcDate(clock.now())` and
      `receivedAt`). No money. No ids.
- [x] No schema change and no migration.
- [x] DI: `recalculateWorkdaysJob`, `closeWorkdaysJob` and `jobScheduler` are each registered
      once. `container.test.ts` is green.
- [x] No secrets, `.env` contents or real personal data. Fixtures use the seed's synthetic RFCs
      and placeholder UUIDs.
- [x] `## Deviations` is honest. Deviation 4 checked: `prisma-workday.repository.ts:33-34` uses
      `$executeRaw` with `${employeeId}::text`. Deviation 3 checked: `app-module.ts`
      `subscribe` cradle now includes `jobQueue` and `clock`, and `wireSubscriptions` passes the
      full cradle (`container.ts:110-113`).
- [x] Docs: `architecture.md` (worker `schedules`), ADR 0016 and its README row, the
      `modules.json` summary and the series README (decisions 20–22, plan link) are updated. No
      other doc describes jobs or attendance recalculation.

**Findings: 0 Critical, 0 High, 0 Medium, 1 Low (needs a code change), 3 Observations (no change
required; the main session decides).**

- **Low-1: jobs from the `attendance.close-workdays` scheduler are kept in Valkey forever.**
  - Location: `apps/api/src/infrastructure/queue/bullmq-job-queue.ts:35-41` (`upsert`).
  - What fails: `upsertJobScheduler` gets a template of only `{ name, data }`. The `Queue` has no
    `defaultJobOptions`, so BullMQ merges `{}` into the template
    (`node_modules/bullmq/dist/esm/classes/queue.js:247`) and the scheduled jobs get no
    `removeOnComplete` or `removeOnFail`. BullMQ's default is to keep every finished job.
    `enqueue` caps retention at 1 000 completed and 5 000 failed jobs (`:28-29`), and
    `architecture.md` describes that cap as the platform's retention policy.
  - Failure scenario: the hourly close produces about 8 760 completed job hashes a year. They
    are never trimmed, and each future `ScheduledJob` adds its own unbounded backlog. The growth
    is small per job, but it never stops, and it is inconsistent with ADR 0016's claim that a
    scheduled job is "un `JobHandler` común".
  - Fix: pass `opts: { removeOnComplete: 1_000, removeOnFail: 5_000 }` in the template, ideally
    shared with `enqueue`. Add a unit test that asserts the template options with a stubbed
    `Queue`, or an integration check if Valkey is available.
- **Observation A (uncertain, not reproduced): `/iclock` latency when Valkey is down.**
  - Location: `record-device-push.command.ts:122` runs before `saveContact` (`:127`).
  - What happens: the enqueue is awaited inside the device request. A BullMQ `Queue` on ioredis
    with default options queues commands offline and retries the connection. During an outage,
    `queue.add` may take seconds or longer to reject. The push is not failed, as the plan
    requires, but it can be held long enough for the device to time out and resend.
  - Effect: the resend is all duplicates, so nothing is enqueued and that trigger is lost. The
    hourly sweep repairs the last 3 dates. This is within the plan's stated outbox limitation.
    Mentioned only because the device path is new to this risk; `enableOfflineQueue: false` or
    a timeout on the enqueue would bound it.
- **Observation B (uncertain): the advisory-lock wait counts toward Prisma's interactive
  transaction timeout.**
  - Location: `recalculate-workdays.command.ts:101-102` and `prisma-database.ts`
    `inTransaction`, which uses `$transaction(fn)` with Prisma's defaults: 5 s timeout, 2 s
    `maxWait`.
  - What happens: a waiter holds its transaction open while it waits for the lock. If several
    recalculations of the same colaborador pile up, for example a history re-upload batch plus
    the sweep plus a manual 62-day call with worker concurrency 5, the last waiter can exceed
    5 s and fail with a transaction-timeout error. The job retries; the manual call would
    return 500.
  - Evidence: the tester's 5-way concurrent integration test passes, so this did not happen at
    the current scale.
- **Observation C: an `AssignEmployeeShift` enqueue failure surfaces as a 500 after the assignment
  is saved** (`assign-employee-shift.command.ts:56-73`).
  - This is the same pattern as `invite-employee.command.ts:129`, and the plan accepts it under
    "Transactional outbox" in Out of scope. HR sees an error. The assignment exists, but its
    recalculation older than the sweep window is lost until HR retries or recalculates by hand.

Status stays `review` for Low-1.

**Repair handoff (main session, 2026-10-14):** Low-1 → fixed inline (implementer role, a
three-line change in a file of step 1): `bullmq-job-queue.ts` exports `KEEP_COMPLETED_JOBS`
(1 000) and `KEEP_FAILED_JOBS` (5 000), uses them in `enqueue` and passes them as
`opts.removeOnComplete` / `opts.removeOnFail` in the `upsertJobScheduler` template; `pnpm
typecheck` green. Being product code, it runs testing → review → verify again: the tester adds
`bullmq-job-queue.test.ts` (declared in step 8) asserting both option sets with a mocked
`Queue`. Observations A–C → accepted as recorded (the sweep repairs a lost punch trigger; the
lock wait vs the 5 s transaction timeout and the post-save enqueue failure are within the plan's
accepted limits); revisit B if logs show transaction timeouts.

## Verification
