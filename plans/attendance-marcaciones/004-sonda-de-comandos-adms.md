---
status: verify
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

6. **Test files of this plan** (declared by the main session after the tester phase)
   - Files: `apps/api/src/modules/attendance/domain/device-command.test.ts` (create), `apps/api/src/modules/attendance/domain/device-record.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.test.ts` (create), `apps/api/src/modules/attendance/application/commands/take-device-command.command.test.ts` (create), `packages/contracts/src/attendance/device-command.contract.test.ts` (create), `apps/api/tests/attendance-device-commands.test.ts` (create), `apps/api/tests/integration/attendance/prisma-device-command.int.test.ts` (create)
   - Do: the layers of "Test layers required".
   - Observable result: `pnpm check` and `pnpm test:integration` pass.

## Acceptance criteria

- [x] `POST /api/v1/attendance/devices/:id/commands` as HOLDING_ADMIN with a `DATA UPDATE USERINFO …`
      text → 201; a `CLEAR …` text → 400; HR → 403; unknown device → 404.
- [x] The next `GET /iclock/getrequest?SN=<that device>` answers exactly the queued text; the
      following one answers `OK`; `GET …/commands` shows it `SENT` with `sentAt`.
- [x] A `POST /iclock/devicecmd` with `ID=1&Return=0&CMD=DATA` logs `zkteco: resultado de comando`
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

Baseline (antes de escribir tests): `pnpm check` verde; `pnpm test:integration` 14 archivos / 172
tests verdes. Cierre: `pnpm check` verde (api 815+ tests, contracts 16 nuevos en
`device-command`), `pnpm test:integration` 15 archivos / 178 tests. No hay GAP ni NOT CONFIRMED
de código: lo no observable en el equipo real queda en Verification (criterio 4 del plan).

| Comportamiento (plan / código)                                                                | Fuente                                      | Capa        | Test                                                                                    | Estado                        |
| --------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------- | --------------------------------------------------------------------------------------- | ----------------------------- |
| `queue` acepta la familia USERINFO (UPDATE/QUERY/DELETE, prefijo `C:n:`)                      | `domain/device-command.ts:34-40`            | domain      | `device-command.test.ts › encola el comando de la familia USERINFO`                     | CONFIRMED                     |
| `queue` rechaza otros comandos, minúsculas, espacio inicial, sin payload                      | `domain/device-command.ts:41-43`            | domain      | `device-command.test.ts › rechaza … con INVALID_VALUE`                                  | CONFIRMED                     |
| Largo 1..500                                                                                  | `domain/device-command.ts:37-39`            | domain      | `device-command.test.ts › rechaza el texto vacío y el que pasa de 500`                  | CONFIRMED                     |
| `markSent` pasa a SENT y es idempotente                                                       | `domain/device-command.ts:84-87`            | domain      | `device-command.test.ts › markSent`                                                     | CONFIRMED                     |
| `parseCommandResult` separa por `&`, LF/CRLF, ignora lo no-par                                | `domain/device-record.ts:67-80`             | domain      | `device-record.test.ts › parseCommandResult`                                            | CONFIRMED                     |
| ID/Return/CMD quedan visibles y el resto redactado                                            | `domain/device-record.ts:49-51`             | domain      | `device-record.test.ts › con redactDeviceFields…`                                       | CONFIRMED                     |
| QueueDeviceCommand: encola, equipo inexistente, comando inválido                              | `queue-device-command.command.ts:35-52`     | application | `queue-device-command.command.test.ts`                                                  | CONFIRMED                     |
| El log de encolado no lleva el texto del comando                                              | `queue-device-command.command.ts:48-52`     | application | `queue-device-command.command.test.ts › registra el encolado sin el texto`              | CONFIRMED                     |
| TakeDeviceCommand: más antiguo primero, una vez, por equipo, log                              | `take-device-command.command.ts:21-30`      | application | `take-device-command.command.test.ts`                                                   | CONFIRMED                     |
| RecordDeviceContact devuelve `{ deviceId }`; resultado de comando redactado, sin cuerpo crudo | `record-device-contact.command.ts:53-68`    | application | `record-device-contact.command.test.ts › resultado de comando (devicecmd)`              | CONFIRMED                     |
| Esquema de entrada: patrón, sin trim, límites 500/vacío                                       | `device-command.contract.ts:12-35`          | contract    | `device-command.contract.test.ts › QueueDeviceCommandSchema`                            | CONFIRMED                     |
| Esquema de lectura y acceso de las dos rutas (`attendance.devices:manage`)                    | `device-command.contract.ts:37-55`          | contract    | `device-command.contract.test.ts › DeviceCommandSchema / attendanceDeviceCommandRoutes` | CONFIRMED                     |
| Criterio 1: 201 admin; CLEAR → 400; HR → 403; sin sesión 401; 404                             | `attendance.router.ts:42-57`                | http        | `attendance-device-commands.test.ts › POST …/commands`                                  | CONFIRMED                     |
| Criterio 2: getrequest entrega el texto exacto una vez, luego OK; orden                       | `zkteco-adms.router.ts:86-93`               | http        | `attendance-device-commands.test.ts › entrega por GET /iclock/getrequest`               | CONFIRMED                     |
| Criterio 2: `GET …/commands` QUEUED → SENT con sentAt; orden y paginación; 404/403            | `attendance.router.ts:55-57`                | http        | `attendance-device-commands.test.ts › GET …/commands`                                   | CONFIRMED                     |
| Criterio 3: `devicecmd` responde OK y registra ID/Return/CMD redactado                        | `zkteco-adms.router.ts:93-97`               | http        | `attendance-device-commands.test.ts › POST /iclock/devicecmd`                           | CONFIRMED                     |
| OpenAPI publica `GET`/`POST` de la bitácora                                                   | `openapi.json`                              | http        | `attendance-device-commands.test.ts › OpenAPI`                                          | CONFIRMED                     |
| Persistencia: ida y vuelta (con tabulador), upsert a SENT                                     | `prisma-device-command.repository.ts:12-28` | integration | `prisma-device-command.int.test.ts › PrismaDeviceCommandRepository`                     | CONFIRMED                     |
| `nextQueued`: más antiguo, desempate por id, por equipo                                       | `prisma-device-command.repository.ts:20-27` | integration | `prisma-device-command.int.test.ts › nextQueued …`                                      | CONFIRMED                     |
| `listDeviceCommands`: más nuevo primero, paginación, filtro por equipo                        | `prisma-attendance.queries.ts:59-74`        | integration | `prisma-device-command.int.test.ts › PrismaAttendanceQueries.listDeviceCommands`        | CONFIRMED                     |
| Criterio 4: el equipo real acepta el comando con PIN alfanumérico                             | plan                                        | —           | no hay equipo en este entorno; lo registra el verificador                               | NOT VERIFIED (fuera de tests) |

Conteos añadidos: domain 20 (14 + 6), application 13 (4 + 4 + 5), contract 16, http 19,
integration 6. Archivos de test nuevos no listados en el plan (esperado por `plans:scope`, solo
tests): `device-command.test.ts`, `queue-device-command.command.test.ts`,
`take-device-command.command.test.ts`, `device-command.contract.test.ts`,
`attendance-device-commands.test.ts`, `prisma-device-command.int.test.ts`; se modificaron
`device-record.test.ts` y `record-device-contact.command.test.ts`.

## Review findings

Revisión 2026-10-02 (reviewer, base del diff `3fd317f`). `status` sigue en `review`: hay un
hallazgo High que requiere cambio de código.

**Checklist: 12/13.**

- [x] `pnpm plans:scope … --base 3fd317f`: solo queda fuera `apps/api/tests/zz-scratch.test.ts`
      (untracked, temporal, el usuario lo borra; no es parte del diff). Hot files: `index.ts` e
      `test-app.ts` solo agregan; `schema.prisma` agrega el modelo y además la back-relation
      `commands` dentro de `AttendanceDevice`, que Prisma exige (aceptable).
- [x] `pnpm check` verde.
- [x] `pnpm test:integration`: 15 archivos / 178 tests verdes.
- [x] Reglas en `domain/` (patrón y largo en `DeviceCommand.queue`, `markSent`).
- [x] CQRS ligero: comandos vía agregado y repositorio; bitácora vía `AttendanceQueries` con DTO.
- [x] Tipos de `@rrhh/contracts`, sin duplicados (el regex duplicado en dominio lo pide el plan).
- [x] `Result` + `DEVICE_NOT_FOUND` / `INVALID_VALUE`.
- [x] `Clock` / `IdGenerator`; fechas `timestamptz`.
- [x] Migración nueva, solo `CREATE TABLE` + índice + FK al mismo schema.
- [x] DI resuelve (`container.test.ts` verde), módulo registrado una vez.
- [x] Sin secretos ni datos reales (RFC y nombre de fixtures son ficticios).
- [x] Deviations honestas (verificada la 5: `bodyLength` sigue en el log, `body` no).
- [ ] **Docs al día — FALLA**: ver L1.

### High

- **H1 — El filtro "solo USERINFO" se evade con saltos de línea.**
  `packages/contracts/src/attendance/device-command.contract.ts:10` y
  `apps/api/src/modules/attendance/domain/device-command.ts:20`/`:42`. El patrón solo ancla el
  inicio (`^…USERINFO `) y no restringe el resto; `\n`/`\r` pasan. `getrequest` devuelve el texto
  tal cual (`http/zkteco-adms.router.ts:91`), y en ADMS la respuesta de `getrequest` puede traer
  varios comandos, uno por línea. Escenario: un HOLDING_ADMIN (o una sesión de admin robada, o un
  error de copiado) encola `"DATA QUERY USERINFO PIN=1\nC:99:CLEAR DATA"` → 201 (ambos niveles
  lo aceptan) → el equipo recibe dos comandos y el segundo puede borrar usuarios o marcaciones del
  equipo físico. Así queda sin efecto la contención que justifica la sonda ("To limit damage,
  only commands about users are accepted") y el criterio 1 (`CLEAR …` → 400) se cumple solo si
  `CLEAR` va al principio. Corrección esperada (en el contrato y en el dominio, con su test):
  rechazar `\r`, `\n` y los demás caracteres de control salvo `\t` (p. ej. `[^\x00-\x08\x0A-\x1F\x7F]`
  al final del patrón con `$`). Hoy ningún test prueba texto multilínea.

### Medium

- **M1 — El texto encolado (RFC + nombre) sale a quien sepa el número de serie** (requiere
  decisión del usuario, no necesariamente cambio de código). `http/zkteco-adms.router.ts:86-92` +
  `application/commands/take-device-command.command.ts:23-27`. El SN es la única credencial del
  equipo (ADR 0013, riesgo aceptado para tráfico _entrante_). Este plan hace que `getrequest`
  devuelva datos personales que escribió un admin: cualquiera que conozca el SN (viene impreso en
  la etiqueta del equipo) y llegue a `/iclock` puede sondear antes que el equipo, recibir el
  comando con PIN/RFC y nombre, y dejarlo en `SENT`, así que el equipo real nunca lo recibe. El
  ADR 0013 ya anota la señal ("si se exponen los `/iclock` fuera de una red controlada…"). Para
  la sonda en red local puede aceptarse; antes del sync (plan 005) hay que decidirlo. Propuesta:
  registrarlo en el README de la serie o en un ADR.

### Low

- **L1 — Doc desactualizada.** `docs/integraciones/zkteco-senseface-2a.md:22` sigue diciendo
  "No envía comandos al equipo: `getrequest` siempre responde `OK`", y contradice la nueva
  sección "Sonda de comandos" (`:96-111`).
- **L2 — Entrega no atómica: un comando puede salir dos veces.** `take-device-command.command.ts:23-27`
  hace `findFirst` QUEUED y luego `upsert`, sin reclamo condicional (`updateMany … where status =
'QUEUED'` y comprobar `count`). Dos `getrequest` concurrentes del mismo SN (reintento del equipo
  o el sondeo de M1) reciben el mismo texto. Para `DATA UPDATE/QUERY` es casi inofensivo; para la
  sonda alcanza con saberlo. Debe resolverse en el 005.
- **L3 — Si llegan varios resultados en un mismo `devicecmd`, solo se registra el último (sin
  confirmar).** `domain/device-record.ts:73-77` mezcla en un solo objeto todos los pares de todas
  las líneas. Si el equipo junta varios resultados en un cuerpo (uno por línea, cada uno con
  `ID&Return&CMD`), los anteriores se pisan y se pierden `ID`/`Return` justo en la evidencia que
  la sonda quiere juntar. Como el formato no se ha observado, queda como incierto; el verificador
  debería revisar `bodyLength` contra lo registrado.
- **L4 — `CMD` puede llevar el texto del comando al log (sin confirmar).** `CMD` está en la
  allowlist (`device-record.ts:51`) con un tope de 64 caracteres. Si el firmware repite el
  comando completo en `CMD` (la literatura dice solo `DATA`), un comando corto como
  `DATA UPDATE USERINFO PIN=X\tName=Ana Rojas` (≤ 64) quedaría con el nombre en el log nivel info.
  El PIN ya se registra por diseño; el nombre no debería. Es un riesgo del formato no observado:
  el verificador debe mirar el valor real de `CMD`.

### Resolution (main session, 2026-10-02)

- **H1 — fixed:** the pattern (contract and domain) is anchored with `$`, uses the `u` flag and
  admits no control character except `\t` (`(?:\t|[^\p{Cc}])*`). Regression cases in
  `device-command.contract.test.ts` and `device-command.test.ts` (`\n`, `\r\n`, `\r`, `\u0000`
  followed by `CLEAR DATA`); `openapi.json` regenerated (the pattern is in the schema).
- **M1 — pending user decision**, recorded in the series README dependency notes: the serial
  number is the only credential, and now queued commands (PIN/RFC and name) go out through it. For
  the probe on the local network it is accepted; plan 005 must not be written without the user
  deciding the barrier (network, proxy, or accepting it in an ADR).
- **L1 — fixed:** runbook line about `getrequest`.
- **L2, L3 — for plan 005** (noted in the README): atomic take of the next command; several
  results per `devicecmd` body.
- **L4 — checked in verification** with the real device's `CMD` value; NOT VERIFIED until then.

## Verification

**Partial: criteria 1–3 PASS; criterion 4 (real device) NOT VERIFIED** — 2026-10-02, main
session, at `d820386`, against the dev API on `localhost:3000` started from the branch (migration
`20261003031633_create_device_commands` applied). The plan stays in `verify` until the user runs
the real-device probe: it is the point of this plan.

- Suites at `d820386`: `pnpm check` green (api 818 passed / 6 skipped, contracts 247);
  `pnpm test:integration` 178 green at the tester phase (the fix touched no infrastructure).
- Script over HTTP and `/iclock` (synthetic sede `Verificación sonda <suffix>`, device
  `SONDA<suffix>`), 9/9 PASS:
  - HOLDING_ADMIN queues `C:1:DATA UPDATE USERINFO PIN=9100\tName=Prueba Sonda` → 201;
    `CLEAR DATA` → 400; review H1 `DATA QUERY USERINFO PIN=1\nC:99:CLEAR DATA` → 400; HR → 403;
    unknown device → 404 `DEVICE_NOT_FOUND`.
  - Next `GET /iclock/getrequest` answers exactly the queued text (with its tab); the following
    one answers `OK`; `GET …/commands` shows it `SENT` with `sentAt`.
  - `POST /iclock/devicecmd` `ID=1&Return=0&CMD=DATA&Name=Prueba Sonda` → `OK`; the API log shows
    `zkteco: resultado de comando` with `ID: "1"`, `Return: "0"`, `CMD: "DATA"`,
    `Name: "[redactado:12]"`.
  - Logs: `comando encolado` and `comando entregado` carry only ids; the text `Prueba Sonda` appears
    0 times in the API output.
- **NOT VERIFIED — criterion 4 and review L4** (needs the SenseFace 2A): register the device with a
  sede, queue the user command for PIN `GOMA850101AB1` / `Ana Rojas`, check the device's user list,
  enroll, mark, see the punch attributed to Ana; record here the exact accepted text, the
  `devicecmd` reply and the real `CMD` value.
- Data left in the dev DB: sede `Verificación sonda <suffix>`, device `SONDA<suffix>` with one
  `SENT` command.
