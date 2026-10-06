---
status: testing
module: attendance
min_implementer: mid
depends_on: ['004']
---

# 006 — Reliable command delivery and command results

## Context

Prepares the command channel of plan 004 for the real sync (007): review findings L2 and L3 of
004, README decisions 12–13 (2026-10-06), and the barrier decision M1 (decision 12).

**What exists today (plan 004, done):**

- `DeviceCommand` entity: `id, deviceId, command, status 'QUEUED'|'SENT', queuedAt, sentAt,
queuedBy`; `queue` validates the USERINFO pattern, optional `C:<n>:` prefix included
  (`apps/api/src/modules/attendance/domain/device-command.ts:7-16`, `:21`, `:33-56`); `markSent`
  (`:88-91`). The same pattern lives in the contract
  (`packages/contracts/src/attendance/device-command.contract.ts:12-13`).
- Delivery is not atomic (review L2): `TakeDeviceCommand` does `nextQueued` then `save`
  (`application/commands/take-device-command.command.ts:20-29`); Prisma `nextQueued` is a
  `findFirst` and `save` an upsert (`infrastructure/prisma-device-command.repository.ts:12-27`).
  Two concurrent `getrequest` of the same SN get the same command.
- Results are only logged: `RecordDeviceContact` parses the `devicecmd` body with
  `parseCommandResult`, which merges every pair of every line into one object (review L3,
  `domain/device-record.ts:71-80`), and logs it redacted
  (`application/commands/record-device-contact.command.ts:61-66`).
- **Observed on the real device** (004 Verification, SenseFace 2A, 2026-10-03): the reply is
  `ID=4&Return=0&CMD=DATA` in one line; `ID` echoes the `n` of `C:<n>:`; `Return=0` is success;
  `CMD` is only the verb. `DATA UPDATE USERINFO` and `DATA QUERY USERINFO` were accepted;
  `DATA DELETE USERINFO` is not tested yet.
- The ADMS router answers `getrequest` with `takeDeviceCommand`'s text or `OK`, and `devicecmd`
  with `OK` after the contact use case (`http/zkteco-adms.router.ts:35-58` `contact` helper,
  `:87-97` the two routes).
- Table `attendance.device_commands` (`apps/api/prisma/schema.prisma:236-250`), DTO mapping
  (`infrastructure/attendance.mapper.ts:49-84`), bitácora query newest first
  (`infrastructure/prisma-attendance.queries.ts:59-74`).
- Conditional claim pattern to copy: `updateMany` with the expected state in the `where` and a
  `count` check (`apps/api/src/modules/identity/infrastructure/prisma-password-reset.repository.ts:27-33`).

**Approach.**

1. **The API numbers every command.** A new `number` column (`SERIAL`, unique) gives each
   command its `C:<n>:`; the stored `command` is the text **without** prefix and the device gets
   `C:<number>:<command>`. Operators can no longer type the prefix (pattern without
   `(C:\d+:)?`), so a reply's `ID` always identifies one command. Alternative: keep
   operator-typed prefixes and match by text — ambiguous (the 004 probe used `C:1:` twice).
2. **Atomic take**: the use case marks the oldest QUEUED command sent and the repository
   **claims** it with `updateMany where { id, status: 'QUEUED' }`; a lost race retries with the
   next one (bounded). Alternative: one raw `UPDATE … FOR UPDATE SKIP LOCKED RETURNING` — fewer
   round trips, but raw rows bypass the mapper; the poll is every ~10 s, so the claim loop is
   enough.
3. **Results close the command**: `devicecmd` bodies are split **per line**, each line its own
   `key=value&…` result (L3); each `ID` + `Return` found closes the matching command of that device:
   `Return=0` → `DONE`, anything else → `FAILED`, code stored. Unknown `ID` → warn, ignored.
   Multi-line bodies are a hypothesis (only one-line replies were observed); one line still works.
4. **M1 accepted in a controlled network** (decision 12): documented in ADR 0014, no code.

## Out of scope

- Sync of colaboradores, users pushed automatically, `device_users` (plan 007).
- More than one command per `getrequest` answer (faster bulk delivery): unconfirmed protocol;
  007 may revisit with evidence.
- Retrying FAILED commands or timeouts for SENT commands without a reply.
- Any barrier code for `/iclock` (decision 12). Web/mobile screens.

## Dependencies

- `004` (done) — `DeviceCommand`, `DeviceCommandRepository`, `TakeDeviceCommand`,
  `QueueDeviceCommand`, the bitácora routes and the ADMS router wiring cited above.

## Steps

1. **Contract**
   - Files: `packages/contracts/src/attendance/device-command.contract.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do: `DEVICE_COMMAND_PATTERN = /^DATA (UPDATE|QUERY|DELETE) USERINFO (?:\t|[^\p{Cc}])*$/u`
     (docblock: the API adds `C:<n>:`; `UPDATE` and `QUERY` confirmed on the SenseFace 2A on
     2026-10-03, `DELETE` not yet). `DeviceCommandSchema` gains `number: z.number().int().positive()`
     (`'Número con el que se envió (C:<n>:); el equipo lo devuelve como ID'`), status
     `z.enum(['QUEUED', 'SENT', 'DONE', 'FAILED'])` (describe: DONE = the device answered
     `Return=0`; FAILED = another code), `returnCode: z.string().nullable()`,
     `completedAt: z.iso.datetime().nullable()`; `command` describe: text without the prefix.
     `QueueDeviceCommandSchema` describe: without `C:<n>:`, the API assigns it. Route
     descriptions: the bitácora shows the device's result. Regenerate `openapi.json`
     (operation count unchanged).
   - Observable result: contracts typecheck passes.

2. **Domain**
   - Files: `apps/api/src/modules/attendance/domain/device-command.ts` (modify), `apps/api/src/modules/attendance/domain/device-command.repository.ts` (modify), `apps/api/src/modules/attendance/domain/device-record.ts` (modify)
   - Do, entity: `DeviceCommandStatus = 'QUEUED' | 'SENT' | 'DONE' | 'FAILED'`; props add
     `number: number`, `returnCode: string | null`, `completedAt: Date | null`. `queue` input adds
     `number`; invalid (`!Number.isSafeInteger(n) || n < 1`) → `InvalidValueError('Número de
comando inválido')`. `COMMAND_PATTERN` mirrors the contract (comment updated). Getters for
     the new props and `get wireText(): string` = `` `C:${number}:${command}` ``.
     `complete(returnCode: string, now: Date): boolean`: only from `SENT` and only when
     `returnCode` matches `/^-?\d{1,15}$/`; sets `DONE` if `'0'` else `FAILED`, `returnCode`,
     `completedAt`; returns whether it changed (a repeated reply returns `false`).
   - Do, repository port: keep `save` and `nextQueued(deviceId)`; add
     `claim(command: DeviceCommand): Promise<boolean>` (persists a command just marked SENT only
     if the row is still QUEUED) + `nextNumber(): Promise<number>` +
     `findByNumber(deviceId: DeviceId, number: number): Promise<DeviceCommand | null>`. `save`
     keeps serving new commands and completions.
   - Do, `device-record.ts`: replace `parseCommandResult` with
     `parseCommandResults(body: string): Record<string, string>[]` — split on `/\r?\n|\r/`, each
     non-empty line split on `&`, same key rules as today; lines without any valid pair are
     dropped. Docblock: one result per line is a hypothesis; one line observed.
   - Observable result: typecheck lists the adapters and use cases to update.

3. **Persistence**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/YYYYMMDDHHMMSS_add_device_command_result/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-device-command.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (modify)
   - Do, schema (`AttendanceDeviceCommand`): `number Int @unique @default(autoincrement())`,
     `returnCode String? @map("return_code") @db.VarChar(16)`,
     `completedAt DateTime? @map("completed_at") @db.Timestamptz(3)`. Generate with
     `pnpm db:migrate --name add_device_command_result`; the SQL must only `ADD COLUMN` (existing
     rows get numbers from the sequence) + the unique index — no `DROP`, no data rewrite. Replace
     the placeholder folder name with the real one; note it in Deviations.
   - Do, mapper: status mapping through a closed set (`QUEUED|SENT|DONE|FAILED`, unknown →
     `QUEUED` as today); the three new fields both ways and in `toDto`.
   - Do, Prisma repository: `nextNumber` =
     `$queryRaw<{ n: number }[]>` `SELECT nextval(pg_get_serial_sequence('attendance.device_commands', 'number'))::int AS n`;
     `claim` = `updateMany({ where: { id, status: 'QUEUED' }, data: { status, sentAt } })` →
     `count === 1`; `findByNumber` = `findFirst({ where: { deviceId, number } })`; `save` passes
     `number` explicitly.
   - Do, in-memory: a counter for `nextNumber`; `claim` stores only if the stored command is
     still `QUEUED`; `findByNumber`; `listDeviceCommands` DTO gets the new fields.
   - Do, queries: nothing beyond the mapper (`toDto` already used, `:73`).
   - Observable result: migration applied; typecheck passes.

4. **Application**
   - Files: `apps/api/src/modules/attendance/application/commands/queue-device-command.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/take-device-command.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/complete-device-commands.command.ts` (create)
   - Do, `QueueDeviceCommand`: `number: await deviceCommandRepository.nextNumber()` passed to
     `queue`; log keeps only ids, adds `number`.
   - Do, `TakeDeviceCommand`: up to 3 attempts: `nextQueued` → null ⇒ `null`; `markSent(now)`;
     `claim` → true ⇒ log `'zkteco: comando entregado'` `{ deviceId, commandId, number }` and
     return `wireText`; false ⇒ next attempt. After 3 lost claims return `null` (the device asks
     again in ~10 s).
   - Do, `RecordDeviceContact`: log one `'zkteco: resultado de comando'` per element of
     `parseCommandResults(body)` (same redaction).
   - Do, `CompleteDeviceCommands` (`UseCase<{ deviceId: string; body: string }, void>`; deps
     `deviceCommandRepository, clock, logger`): for each parsed result with `ID` matching
     `/^\d{1,9}$/` and a `Return`: `findByNumber(deviceId, Number(ID))`; missing → warn
     `'zkteco: resultado sin comando'` `{ deviceId, number }`; else `complete(Return, now)` and,
     if it changed, `save` + info `'zkteco: comando completado'`
     `{ deviceId, commandId, number, status, returnCode }` (FAILED at warn level). Never logs the
     command text.
   - Observable result: typecheck passes.

5. **ADMS router and module**
   - Files: `apps/api/src/modules/attendance/http/zkteco-adms.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify)
   - Do: router deps add `completeDeviceCommands`; `devicecmd` becomes
     `contact('command-result', async ({ deviceId }, body) => { await
deps.completeDeviceCommands.execute({ deviceId, body }); return 'OK'; })` — extend the
     `contact` helper so `onOk` also receives the body it already read. Register
     `completeDeviceCommands` in the cradle and registrations.
   - Observable result: `tests/container.test.ts` resolves it; `pnpm check` passes.

6. **ADR and docs**
   - Files: `docs/adr/0014-comandos-salientes-con-serial-como-credencial.md` (create), `docs/adr/README.md` (modify), `docs/integraciones/zkteco-senseface-2a.md` (modify)
   - Do, ADR 0014 (from `docs/adr/0000-plantilla.md`, Spanish, Aceptado, 2026-10-06): context =
     review M1 of plan 004 (the queued command carries RFC and name and is handed to whoever
     polls with the serial; ADR 0013 already flags exposure); decision = accepted while `/iclock`
     is reachable only from a controlled network (office LAN/VPN); exposing it to the internet
     requires first a barrier (proxy with source-IP allowlist or mTLS) and a new ADR;
     consequences = a stolen-serial poll can steal and consume one command (visible in the
     bitácora as SENT without result). Add it to the ADR index.
   - Do, runbook: section "Sonda de comandos" → the API assigns `C:<n>:`; statuses
     QUEUED/SENT/DONE/FAILED with `returnCode`; `QUERY` confirmed on 2026-10-03; new log lines
     (`comando completado`, `resultado sin comando`); link to ADR 0014.
   - Observable result: `pnpm check` passes (docs tests included).

7. **Existing tests forced by the change** (fixtures only, no new cases: the tester adds them)
   - Files: `apps/api/src/modules/attendance/domain/device-command.test.ts` (modify), `apps/api/src/modules/attendance/domain/device-record.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/take-device-command.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify), `packages/contracts/src/attendance/device-command.contract.test.ts` (modify), `apps/api/tests/attendance-device-commands.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-device-command.int.test.ts` (modify)
   - Do: pass `number` to `queue`; expected delivered text becomes `C:<n>:…`; cases that typed a
     `C:n:` prefix now expect rejection (400 / `INVALID_VALUE`) — note each changed assertion in
     Deviations; `parseCommandResult` → `parseCommandResults`.
   - Observable result: `pnpm check` and `pnpm test:integration` pass.

## Acceptance criteria

- [ ] `POST …/devices/:id/commands` with `DATA QUERY USERINFO PIN=X` → 201; the bitácora shows
      it `QUEUED` with a `number`; with a `C:9:DATA QUERY USERINFO PIN=X` text → 400.
- [ ] The next `GET /iclock/getrequest` answers exactly `C:<number>:DATA QUERY USERINFO PIN=X`;
      the bitácora shows it `SENT`.
- [ ] `POST /iclock/devicecmd` with `ID=<number>&Return=0&CMD=DATA` → `OK`; the bitácora shows
      `DONE`, `returnCode: "0"`, `completedAt`. With `Return=-1` on another command → `FAILED`.
      With an unknown `ID` → `OK` and a warn `zkteco: resultado sin comando`.
- [ ] A body with two lines (`ID=a&Return=0&CMD=DATA\nID=b&Return=0&CMD=DATA`) closes both.
- [ ] Integration: two concurrent takes of the same device with one QUEUED command → exactly one
      gets it, the other gets `null`.
- [ ] Rows created by plan 004 in the dev DB have a `number` after the migration and still list.
- [ ] **Real device:** a queued `DATA QUERY USERINFO PIN=<existing PIN>` ends `DONE` with
      `returnCode "0"` in the bitácora. NOT VERIFIED without the device.

## Test layers required

| Layer       | Applies | Focus                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------- |
| domain      | yes     | `queue` number rule, pattern without prefix, `wireText`, `complete` transitions, parser   |
| application | yes     | take retries on a lost claim; complete (DONE/FAILED/unknown/repeat); queue assigns number |
| contract    | yes     | pattern rejects the prefix; new DTO fields and statuses                                   |
| http        | yes     | acceptance criteria 1–4 over supertest                                                    |
| integration | yes     | migration on existing rows, `nextNumber`, `claim` race, `findByNumber`, DTO fields        |
| e2e         | no      | (no e2e infrastructure yet)                                                               |

## Deviations

1. **Migration written from `prisma migrate diff`** (cosmetic): `pnpm db:migrate` stops in a
   non-interactive shell because of the unique-index warning. The SQL came from
   `prisma migrate diff --from-config-datasource --to-schema` (only `ADD COLUMN` ×3 + unique
   index, no `DROP`), saved as `20261006120000_add_device_command_result/migration.sql` and
   applied with `db:deploy`.
2. **Dev DB was behind** (note): before this migration, `migrate dev` applied 9 existing
   migrations (`create_role_assignments` … `create_device_commands`) that the local `rrhh` DB
   lacked. Nothing was dropped. So the dev DB had **no** plan-004 command rows, and acceptance
   criterion 6 (existing rows get a `number`) cannot be checked there; the `SERIAL` column fills
   existing rows by Postgres semantics; for the verifier.
3. **In-memory reads return copies** (cosmetic, needed by the plan): `nextQueued` and
   `findByNumber` return a copy, as a DB read would; otherwise `markSent` on the returned object
   mutated the stored one and `claim` always lost.
4. **`markSent` guard** (cosmetic): it now acts only from `QUEUED` (was "not SENT"), so a DONE or
   FAILED command never goes back to SENT.
5. **Assertions changed in Step 7 files** (forced by the plan's behavior):
   - `device-command.test.ts` and `device-command.contract.test.ts`: `C:12:DATA UPDATE USERINFO
PIN=1` moved from "accepted" to "rejected".
   - `device-command.contract.test.ts`: the "unknown status" case used `FAILED`, now valid;
     it uses `CANCELLED`.
   - `device-record.test.ts`: the multi-line case now expects one result per line.
   - `record-device-contact.command.test.ts`: a body without pairs no longer logs an empty
     result ("no registra ningún resultado").
   - `tests/attendance-device-commands.test.ts`: delivered texts carry `C:<n>:`; the multi-line
     `devicecmd` case sends two one-line results and expects two log lines.
   - `queue-device-command.command.test.ts` / `take-device-command.command.test.ts`: logs carry
     `number`.
6. **Lint** (cosmetic): `result.ID` / `result.Return` in dot notation (`dot-notation` rule).

Run at the end: `pnpm check` green (api 838 passed / 5 skipped, contracts 259);
`pnpm test:integration` 15 files / 178 tests green.

## Test coverage

## Review findings

## Verification
