---
status: testing
module: attendance
min_implementer: mid
depends_on: ['003']
---

# 004 — ADMS command probe

## Context

**What exists today:**

- The device polls `GET /iclock/getrequest` every ~10 s and the API always answers `OK`; results
  of commands would arrive at `POST /iclock/devicecmd`, also answered `OK`
  (`apps/api/src/modules/attendance/http/zkteco-adms.router.ts:77-84`). Both go through
  `RecordDeviceContact`, which logs `{ kind, method, path, query, bodyLength }` — never the body
  (`application/commands/record-device-contact.command.ts:11-18`, `:38-56`; router `:33-52`).
- The API has **never** sent a command to a device: `attendance-sonda-zkteco/001` and
  `attendance-marcaciones/001` kept it out of scope. So the exact command syntax the SenseFace 2A
  accepts, and the format of its `devicecmd` reply, are **not observed** anywhere in this repo.
- The device's keypad only accepts numeric user IDs; Buk creates users with the RFC as PIN
  remotely (user, 2026-10-02). Attribution by RFC (`002`, done) therefore needs users pushed from
  the API, which needs this protocol knowledge first.
- Redaction of device fields is an allowlist (`domain/device-record.ts:55-106`); the body parser
  for `key=value` pairs exists for pushes (`http/zkteco-adms.parser.ts:72-82`).

**What we need:** learn, against the real device, the command line that creates a user with an
alphanumeric PIN and the reply format, before designing the real sync (plan 005).

**Approach.** A probe in the spirit of `attendance-sonda-zkteco/001`: HOLDING_ADMIN queues a raw
command text for one device; the next `getrequest` from that device returns exactly that text
(once); `devicecmd` bodies are parsed as `key=value` pairs (split on `&` and on newlines) and
logged with the redaction allowlist plus `ID`, `Return`, `CMD`. Commands are kept in a small log
table (the command bitácora) so the verifier can see what was sent and when. To limit damage,
only commands about users are accepted: the text must match
`/^(C:\d+:)?DATA (UPDATE|QUERY|DELETE) USERINFO /` — this matches the command family named in
ZKTeco's PUSH protocol literature but is a **hypothesis to confirm**, not observed. If the device
rejects every variant, the verifier records it and the plan stops there (no guessing in code).
Alternative considered: hardcoding one command format in a sync use case — rejected, it would be
invented.

## Out of scope

- Automatic or manual sync of colaboradores, deletions on termination (plan 005).
- Any command outside the `USERINFO` family (clear data, reboot, options, biometrics upload).
- Correlating replies to commands beyond logging (no state machine).
- Web/mobile screens.

## Dependencies

- `003` (same initiative) — `DeviceNotFoundError` in `apps/api/src/modules/attendance/domain/errors.ts`
  and devices tied to a sede (the probe runs on the real device after it gets its sede).

## Steps

1. **Contract**
   - Files: `packages/contracts/src/attendance/device-command.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do: `DEVICE_COMMAND_PATTERN = /^(C:\d+:)?DATA (UPDATE|QUERY|DELETE) USERINFO /` (exported,
     docblock: hypothesis of this probe). `QueueDeviceCommandSchema = z.object({ command:
z.string().min(1).max(500).regex(DEVICE_COMMAND_PATTERN, 'Solo comandos USERINFO') })`
     (`.meta({ id: 'QueueAttendanceDeviceCommandInput' })`; no trim: tabs are significant).
     `DeviceCommandSchema` (`.meta({ id: 'AttendanceDeviceCommand' })`): `id: z.uuid()`,
     `command: z.string()`, `status: z.enum(['QUEUED', 'SENT'])`, `queuedAt`, `sentAt`
     (nullable) ISO datetimes, `queuedBy: z.uuid()`. Routes `attendanceDeviceCommandRoutes`:
     `queueDeviceCommand` `POST /attendance/devices/:deviceId/commands`
     (`requires('attendance.devices:manage')`, 201 `CreatedSchema`) and `listDeviceCommands`
     `GET /attendance/devices/:deviceId/commands` (`requires('attendance.devices:manage')`,
     `PageQuerySchema`, `pageOf(DeviceCommandSchema)`). Add to `apiRoutes`; regenerate; operation
     count +2.
   - Observable result: contracts tests pass.

2. **Domain and persistence of the bitácora**
   - Files: `apps/api/src/modules/attendance/domain/device-command.ts` (create), `apps/api/src/modules/attendance/domain/device-command.repository.ts` (create), `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261003031633_create_device_commands/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/prisma-device-command.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify)
   - Do: `DeviceCommand` entity (`id`, `deviceId`, `command`, `status: 'QUEUED' | 'SENT'`,
     `queuedAt`, `sentAt`, `queuedBy`) with `static queue(...)` (validates the pattern, re-using
     the contract constant through `@rrhh/contracts` is NOT allowed in domain — duplicate the
     regex in the entity with a comment pointing to the contract) and `markSent(now)`.
     Repository: `save`, `nextQueued(deviceId): Promise<DeviceCommand | null>` (oldest QUEUED).
     Table `attendance.device_commands` (`id uuid`, `device_id uuid` FK to `devices` (same
     module), `command varchar(500)`, `status varchar(8)`, `queued_at`, `sent_at` timestamptz(3),
     `queued_by uuid`), `@@index([deviceId, status, queuedAt])`. Migration only creates the table;
     replace the placeholder; note in Deviations. In-memory store gets a `commands` map and an
     `InMemoryDeviceCommandRepository`.
   - Observable result: migration applied; typecheck passes.

3. **Application**
   - Files: `apps/api/src/modules/attendance/application/commands/queue-device-command.command.ts` (create), `apps/api/src/modules/attendance/application/commands/take-device-command.command.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/queries/attendance.queries.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (modify), `apps/api/src/modules/attendance/domain/device-record.ts` (modify), `apps/api/src/modules/attendance/application/queries/list-device-commands.query.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify)
   - Do: `QueueDeviceCommand` (deps `deviceRepository, deviceCommandRepository, idGenerator,
clock, logger`): device must exist (`DeviceNotFoundError`, created by plan 003); queue; log
     info `'zkteco: comando encolado'` `{ serialNumber, commandId }` (never the command text at
     info level: it may carry a PIN/name). `TakeDeviceCommand` (deps `deviceCommandRepository,
clock, logger`): `nextQueued`, `markSent`, save, log info `'zkteco: comando entregado'`
     `{ deviceId, commandId }`; returns the text or `null`. `RecordDeviceContact`: input gains
     `body: string`; for `kind === 'command-result'` parse the body into `key=value` pairs (split
     on `&` and `\n`) and log info `'zkteco: resultado de comando'` with `redactDeviceFields`
     after adding `ID`, `Return`, `CMD` to `LOGGABLE_DEVICE_FIELDS` (`device-record.ts:61-82`).
     Queries: `listDeviceCommands(deviceId, page)` newest first.
   - Observable result: typecheck passes.

4. **HTTP, ADMS router, module**
   - Files: `apps/api/src/modules/attendance/http/zkteco-adms.router.ts` (modify), `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do: `getrequest`: after a successful contact, `const next = await
deps.takeDeviceCommand.execute({ deviceId })` — the contact use case must return the device
     id for this (extend its `ok` value to `{ deviceId }`); answer `next ?? 'OK'`. `devicecmd`:
     pass the body to the contact use case; still answer `OK`. Bind the two new routes
     (`queuedBy` = `requireActor(ctx).userId`). Register `deviceCommandRepository` (Prisma),
     `queueDeviceCommand`, `takeDeviceCommand`; in-memory repository in `test-app.ts`.
   - Observable result: `pnpm check` passes.

5. **Docs**
   - Files: `docs/integraciones/zkteco-senseface-2a.md` (modify)
   - Do: section "Sonda de comandos": how to queue a command, that only `USERINFO` commands are
     accepted, that the next poll delivers it once, where to read the result (log
     `zkteco: resultado de comando`, `GET …/commands`), and that the format is being confirmed.
   - Observable result: `pnpm check` passes.

## Acceptance criteria

- [ ] `POST /api/v1/attendance/devices/:id/commands` as HOLDING_ADMIN with a `DATA UPDATE USERINFO …`
      text → 201; a `CLEAR …` text → 400; HR → 403; unknown device → 404.
- [ ] The next `GET /iclock/getrequest?SN=<that device>` answers exactly the queued text; the
      following one answers `OK`; `GET …/commands` shows it `SENT` with `sentAt`.
- [ ] A `POST /iclock/devicecmd` with `ID=1&Return=0&CMD=DATA` logs `zkteco: resultado de comando`
      with those three values; other fields come out redacted.
- [ ] **Real device (the point of the probe):** a command creating user PIN `GOMA850101AB1`, name
      `Ana Rojas` is accepted by the SenseFace 2A — the user appears in the device's user list,
      can be enrolled (face/fingerprint) from the device menu, and a marcación by that user arrives
      as ATTLOG with that PIN and is attributed to Ana by plan 002. The exact command text and the
      `devicecmd` reply are recorded in Verification. NOT VERIFIED without the device.

## Test layers required

| Layer       | Applies | Focus                                                                                  |
| ----------- | ------- | -------------------------------------------------------------------------------------- |
| domain      | yes     | `DeviceCommand.queue` pattern, `markSent`                                              |
| application | yes     | queue (device missing), take (oldest first, once), contact logs parsed result redacted |
| contract    | yes     | pattern accepts USERINFO family only; routes access                                    |
| http        | yes     | acceptance criteria 1–3 over supertest (including `/iclock`)                           |
| integration | yes     | `device_commands` persistence and `nextQueued` order                                   |
| e2e         | no      | (no e2e infrastructure yet)                                                            |

## Deviations

Todas cosméticas (fix forward):

1. Migración `20261003031633_create_device_commands` generada con `pnpm db:migrate` (nombre real
   en lugar del placeholder `YYYYMMDDHHMMSS_`); solo crea la tabla, su índice y la FK.
2. Archivo adicional no listado: `application/queries/list-device-commands.query.ts`
   (`ListDeviceCommands`). El router solo puede usar casos de uso por DI, y así `GET …/commands`
   de un equipo inexistente responde 404 (`DeviceNotFoundError`).
3. `infrastructure/attendance.mapper.ts` modificado (no listado) para `DeviceCommandMapper`
   (convención: el mapper es el único lugar donde conviven filas Prisma y dominio).
4. `record-device-contact.command.test.ts` (no listado) ajustado mínimamente para compilar con
   el nuevo campo `body` y para esperar que el cuerpo no aparezca en el log de contacto.
5. `RecordDeviceContact` conserva `bodyLength` además de `body`; el cuerpo se excluye del log de
   contacto y el resultado de comando se registra como `{ serialNumber, fields }` redactado.
6. `parseCommandResult` vive en `domain/device-record.ts` (archivo del plan) y `openapi.test.ts`
   sube el conteo de operaciones de 27 a 29.

## Test coverage

## Review findings

## Verification
