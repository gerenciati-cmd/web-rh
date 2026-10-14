---
status: draft
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

## Test coverage

## Review findings

## Verification
