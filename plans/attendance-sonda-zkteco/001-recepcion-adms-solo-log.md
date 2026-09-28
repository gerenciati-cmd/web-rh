---
status: testing
module: attendance
min_implementer: mid
depends_on: []
---

# 001 — ADMS push reception, log-only probe for the ZKTeco SenseFace 2A

## Context

**What exists today.**

- Modules plug into the monolith through `AppModule` (`apps/api/src/shared/app-module.ts:12-22`);
  its only HTTP hook is `router`, mounted under `/api/v1` (`app-module.ts:16-17`,
  `apps/api/src/http/app.ts:37-41`, `API_PREFIX` at `app.ts:13`).
- The app parses JSON bodies only (`app.ts:23`). There is no text body parser.
- Every endpoint goes through `bindRoute`, which validates with the Zod contract and **always
  responds JSON** (`apps/api/src/http/bind-route.ts:64-85`, JSON at line 84). ADR 0004 makes
  contracts mandatory for endpoints (`docs/adr/0004-contratos-zod.md:13-16`).
- Active modules are listed in `apps/api/src/container.ts:36` and their cradles merged at
  `container.ts:52`. Module registration shape: `apps/api/src/modules/organization/organization.module.ts:141-164`;
  public API file: `apps/api/src/modules/organization/index.ts:1-7`.
- Env config is a Zod schema with fail-fast (`apps/api/src/config/env.ts:9-24`); `CORS_ORIGINS`
  shows the comma-separated list idiom (`env.ts:13-21`). Example file: `apps/api/.env.example:1-14`.
- `Logger` port: `apps/api/src/shared/application/ports.ts:34-39`. `Command` type:
  `apps/api/src/shared/application/use-case.ts:13-16`. Domain error base classes:
  `packages/domain/src/errors.ts:5-35`; module error shape: `apps/api/src/modules/organization/domain/errors.ts:1-17`.
- Test fakes live in `apps/api/src/shared/testing/fakes.ts:1-45` (no logger double yet). The DI
  safety net resolves every registration (`apps/api/tests/container.test.ts:16-20`).
- The `attendance` module does not exist yet; it is registered as `planned` in
  `docs/harness/modules.json` (entry `attendance`).

**What we need.** A probe that lets a SenseFace 2A push to the API over ADMS (README decisions
1–4): answer the protocol so the device keeps sending, and log everything it sends, redacting
biometrics and secrets, without persistence.

**Approach.** Two options were compared: (a) define the `/iclock/*` routes in `@rrhh/contracts`
and extend `bindRoute` with a text mode; (b) add a second, optional hook `deviceRouter` to
`AppModule`, mounted at the app root, whose routes are hand-written Express handlers outside the
contract catalogue. (a) would put a device protocol into the catalogue from which the web/mobile
client is derived, and change `bindRoute` for every endpoint. (b) is chosen: it is additive, keeps
`bindRoute` and contracts untouched, and the exception is recorded in a new ADR 0008. The use
cases are thin: no aggregate and no repository exist because nothing is persisted (decision 2).
A later series introduces the marcación aggregate.

**Imitated files.** Module registration: `organization.module.ts:141-164`. Router factory with
`deps`: `apps/api/src/modules/organization/http/organization.router.ts:11-33`. Domain errors:
`organization/domain/errors.ts:3-9`. Env list parsing: `env.ts:13-21`.

**Device protocol: CONFIRMED by capture (2026-09-28).** The user pointed the real device at a
throwaway probe outside the repo. The probe answered with the exact options block of step 5 and
`OK`/`OK: <n>` elsewhere, and logged the traffic with templates redacted. Observed:

- Device: `DeviceName=SenseFace 2A`, `FWVersion=ZAM70-NF24HA-Ver3.3.12`,
  `PushVersion=Ver 3.1.2S-20250616`. Handshake query: `pushver=2.4.1`, `DeviceType=att`,
  `language=101`, `PushOptionsFlag=1`. User-Agent `iClock Proxy/1.09`. `Content-Type: text/plain`
  on POSTs. Menu "Modo servidor ADMS": "Habilitar nombre de dominio" (off → a "Puerto del
  servidor" field appears), "Dirección del servidor", "Habilitar servidor proxy". No HTTPS option.
- The classic `cdata` flow is used. No `registry`/`push` calls were seen. The device accepted our
  options block: it then uploaded data and polled `getrequest` about every 10 s (`Delay=10`).

| Device call                                    | Meaning                                            | Our response (text/plain)         |
| ---------------------------------------------- | -------------------------------------------------- | --------------------------------- |
| `GET /iclock/cdata?SN=…&options=all&pushver=…` | Handshake                                          | Options block (step 5)            |
| `POST /iclock/cdata?SN=…&table=options`        | Device info, one line                              | `OK: 1`                           |
| `POST /iclock/cdata?SN=…&table=T&Stamp=9999`   | Data upload (`ATTLOG`, `OPERLOG`, `BIODATA`)       | `OK: <number of non-empty lines>` |
| `GET /iclock/getrequest?SN=…[&INFO=…]`         | Poll; `INFO` = comma list (firmware, counters, IP) | `OK` (no commands, decision 2)    |
| `POST /iclock/devicecmd?SN=…`                  | Result of a command (not observed)                 | `OK`                              |

Observed line formats (synthetic values here):

- `table=options`: one line of comma-separated `~?Key=Value` pairs, e.g.
  `~DeviceName=SenseFace 2A,MAC=…,FWVersion=…,PushVersion=…`. **Values may contain commas**
  (a vendor string `… CO., LTD.` was seen), so split only on commas followed by `~?Key=`.
- `table=ATTLOG`: positional, tab-separated, with a trailing tab:
  `2\t2026-09-28 10:47:39\t0\t1\t0\t0\t0\t0\t0\t0\t` → PIN, device-local time, status,
  verify mode, then extra fields.
- `table=OPERLOG` has two line kinds:
  - `OPLOG <code>\t<adminPin>\t<time>\t<obj1>\t<obj2>\t<obj3>\t<obj4>` (positional, e.g.
    `OPLOG 82\t1\t2026-09-28 10:41:20\tadd adms address\t0\t0\t0`, `OPLOG 7\t0\t…\t2\t0\t0\t0`).
  - `USER PIN=2\tName=…\tPri=0\tPasswd=…\tCard=\tGrp=1\tTZ=…\tVerify=0\tViceCard=\tExpires=0\tStartDatetime=0\tEndDatetime=0`.
- `table=BIODATA` (fingerprint): `BIODATA Pin=2\tNo=6\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=<1400 chars>`.
  Note `Pin`, not `PIN`.
- Face enrolment (captured). It sends three records, all inside `table=OPERLOG` except the
  template, which goes to `BIODATA`:
  - `BIOPHOTO PIN=2\tNo=0\tIndex=0\tFileName=2.jpg\tType=9\tSize=32576\tContent=<32576 chars base64 JPG>`
  - `BIODATA Pin=2\tNo=0\tIndex=0\tValid=1\tDuress=0\tType=9\tMajorVer=40\tMinorVer=1\tFormat=0\tTmp=<756 chars>`
  - `USERPIC PIN=2\tFileName=2.jpg\tSize=32576\tContent=<32576 chars>`

  Bodies reach ~33 KB, well under the 5 MB text limit. `Content`, `Tmp` and `FileName` are
  outside the allowlist, so they are redacted.

- ATTLOG verify mode: observed `1` after the fingerprint test and `15` after the face test. This
  plan does not interpret the value (logged raw).
- The device clock reads UTC−5 (device 10:47 vs server 15:47 UTC). That is correct: the device
  is in Cancún (Quintana Roo, UTC−5 all year, no DST). Device times carry no offset. Offset
  handling belongs to the later marcación series (the time is logged raw here).

The catch-all route in step 6 stays, in case other firmware paths show up.

## Out of scope

- Any persistence: Prisma models, `attendance` schema, migrations (decision 2).
- Sending commands to the device (user enrollment, template pull, reboot); `getrequest` always
  answers `OK` (decision 2).
- JSON endpoints under `/api/v1`, contracts in `packages/contracts`, web and mobile.
- Linking device `PIN` to a colaborador, time zone normalisation of device time, and any rule of
  marcación / jornada / Dirección del Trabajo. The device time is logged as the raw string.
- The PUSH 3.x `registry`/`push` flow, TLS/HTTPS, device comm keys, rate limiting. The catch-all
  only logs these; a later plan adds support if the device needs it.
- Changing `bindRoute`, the error handler, or the existing `router` hook.

## Dependencies

None

## Steps

1. **Device serial allowlist in env**
   - Files: `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify)
   - Do: add `ZKTECO_ALLOWED_SERIALS` to `EnvSchema` with the same idiom as `CORS_ORIGINS`
     (`env.ts:13-21`): string, default `''`, transformed into a trimmed, non-empty `string[]`. In
     `.env.example`, add a `# ── Dispositivos ZKTeco (ADMS) ──` section with a comment
     (`Números de serie autorizados a enviar datos, separados por coma. Vacío = ninguno.`) and
     `ZKTECO_ALLOWED_SERIALS=`. Never touch `.env`.
   - Observable result: `loadEnv({ …, ZKTECO_ALLOWED_SERIALS: 'A1, B2' })` yields `['A1', 'B2']`;
     omitted yields `[]`.

2. **Optional root-mounted device router in `AppModule`**
   - Files: `apps/api/src/shared/app-module.ts` (modify), `apps/api/src/http/app.ts` (modify)
   - Do: add `readonly deviceRouter?: (cradle: TCradle) => Router;` to `AppModule`, with a
     docblock in Spanish: routes for physical devices, mounted at the app root outside
     `/api/v1` and outside the contracts (ADR 0008). In `createApp`, right before
     `const api = Router();` (`app.ts:37`), loop over `modules` and
     `app.use(module.deviceRouter(container.cradle))` when present. Nothing else in `app.ts`
     changes.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes. Existing routes behave the same
     (existing http tests pass).

3. **Domain: record types, redaction rule, error**
   - Files: `apps/api/src/modules/attendance/domain/device-record.ts` (create), `apps/api/src/modules/attendance/domain/errors.ts` (create)
   - Do in `device-record.ts` (pure, no imports outside `@rrhh/domain`):
     - `export type DevicePushRecord`, a union of four variants:
       - `{ kind: 'attendance'; pin: string; deviceTime: string; status: string; verifyMode: string; extraFields: number }`
       - `{ kind: 'operation'; code: string; adminPin: string; deviceTime: string; objects: readonly string[] }`
       - `{ kind: 'entry'; prefix: string; fields: Readonly<Record<string, string>> }`
       - `{ kind: 'unparsed'; length: number }`
     - `export const LOGGABLE_DEVICE_FIELDS` = a `ReadonlySet<string>` of the metadata keys whose
       value may be logged. Matching is exact, since the device mixes `PIN` and `Pin`. The keys:
       `PIN`, `Pin`, `FID`, `No`, `Index`, `Valid`, `Duress`, `Type`, `MajorVer`, `MinorVer`,
       `Format`, `Size`, `Pri`, `Grp`, `TZ`, `Verify`, `Expires`, `DeviceName`, `FWVersion`,
       `PushVersion`. `Name`, `Passwd`, `Card`, `ViceCard`, `Tmp` and `MAC` are deliberately
       excluded.
     - `export function redactDeviceFields(fields: Readonly<Record<string, string>>): Record<string, string>`:
       keeps every key. The value is kept only if the key is in `LOGGABLE_DEVICE_FIELDS` and the
       value is at most 64 characters long. Otherwise it is replaced by `[redactado:<length>]`.
       The docblock explains why: templates, photos, passwords, card numbers and names are personal
       data (README decision 3). An allowlist fails closed on keys we don't know yet.
   - Do in `errors.ts`: `DeviceNotAllowedError extends BusinessRuleViolationError` with
     `code = 'DEVICE_NOT_ALLOWED'`, message `'El dispositivo no está autorizado'`, details
     `{ serialNumber }` (shape as `organization/domain/errors.ts:3-9`).
   - Observable result: `pnpm arch:check` passes (domain purity rules).

4. **Application: two log-only use cases**
   - Files: `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (create)
   - Do: both implement `Command<…, …, DeviceNotAllowedError>`
     (`use-case.ts:13-16`), with `interface Deps { logger: Logger; allowedDeviceSerials: readonly string[] }`.
     If `serialNumber` is not in `allowedDeviceSerials`, `logger.warn({ serialNumber, … }, 'zkteco: dispositivo no autorizado')`
     and return `err(new DeviceNotAllowedError(serialNumber))`. An empty allowlist rejects
     everything.
     - `RecordDeviceContact` input:
       `{ serialNumber: string; kind: 'handshake' | 'poll' | 'command-result' | 'unknown'; method: string; path: string; query: Readonly<Record<string, string>>; bodyLength: number }`.
       Logs with `logger.debug` for `poll` (the device polls every few seconds) and `logger.info`
       for the rest, message `'zkteco: contacto del dispositivo'`. Returns `ok(undefined)`.
     - `RecordDevicePush` input:
       `{ serialNumber: string; table: string; records: readonly DevicePushRecord[] }`.
       Logs one `logger.info({ serialNumber, table, total, byKind }, 'zkteco: datos recibidos')`,
       where `byKind` counts records per `kind` (for `entry`, per `prefix`). Then one
       `logger.debug({ serialNumber, table, record }, 'zkteco: registro')` per record. For `entry`
       records, `fields` has already gone through `redactDeviceFields`. Returns `ok({ accepted: records.length })`.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes.

5. **HTTP adapter: ADMS wire-format parser**
   - Files: `apps/api/src/modules/attendance/http/zkteco-adms.parser.ts` (create)
   - Do: pure functions, no Express imports:
     - `parseAdmsBody(table: string, body: string): DevicePushRecord[]`: split on `\n`, strip a
       trailing `\r`, drop empty lines, then parse each line (formats in `## Context`, observed on
       the device):
       - `table` is `options` (case-insensitive): split the line with the regex
         `/,(?=~?[A-Za-z]\w*=)/`, so commas inside values survive. Strip a leading `~` from each
         key. Split each pair on the first `=`. The result is
         `{ kind: 'entry', prefix: 'options', fields: redactDeviceFields(parsed) }`.
       - `table` is `ATTLOG` (case-insensitive): split on `\t` and drop a trailing empty field.
         With at least 2 fields, the result is `attendance`: `pin` = field 0, `deviceTime` =
         field 1, `status` = field 2 or `''`, `verifyMode` = field 3 or `''`, `extraFields` =
         remaining count. Otherwise the result is `unparsed`.
       - Any other table, per line: `prefix` = text before the first space, and the rest is split
         on `\t`.
         - If `prefix` is `OPLOG` and there are at least 3 parts, the result is `operation`:
           `code` = text after `OPLOG `, `adminPin` = part 1, `deviceTime` = part 2, `objects` =
           the remaining parts. Objects are operation codes/PINs/setting names, not personal data
           per the capture.
         - Else, when every part is `key=value` (split on the **first** `=`), the result is `entry`
           with `fields = redactDeviceFields(parsed)`. This covers `USER`, `BIODATA` and unknown
           prefixes such as a face record.
         - Else `unparsed`.
       - The raw line content is never returned for `unparsed`, only its length.
     - `admsOptionsResponse(serialNumber: string): string`: returns the handshake block joined
       with `\n`:
       `GET OPTION FROM: <SN>`, `ATTLOGStamp=None`, `OPERLOGStamp=None`, `ATTPHOTOStamp=None`,
       `ErrorDelay=30`, `Delay=10`, `TransTimes=00:00;14:05`, `TransInterval=1`,
       `TransFlag=TransData AttLog OpLog EnrollUser ChgUser EnrollFP ChgFP FACE UserPic BioPhoto`,
       `Realtime=1`, `Encrypt=None`. A comment says the block was accepted by a SenseFace 2A
       (`ZAM70-NF24HA-Ver3.3.12`) on 2026-09-28, and that `Stamp=None` asks for the full history.
   - Observable result: typecheck passes. The tester derives parser unit tests from this step.

6. **HTTP adapter: `/iclock` router**
   - Files: `apps/api/src/modules/attendance/http/zkteco-adms.router.ts` (create)
   - Do: `createZktecoAdmsRouter(deps: { recordDeviceContact: RecordDeviceContact; recordDevicePush: RecordDevicePush }): Router`.
     Docblock: thin adapter, `text/plain` protocol, outside the contracts per ADR 0008. Inside:
     - `router.use('/iclock', express.text({ type: () => true, limit: '5mb' }))`. It is scoped
       to `/iclock` so it never touches `/api/v1` bodies. The device may send any
       `Content-Type`.
     - A local Zod schema for the query: `SN` required, string length 1–64; `table` optional
       string length ≤ 32. Unknown keys are passed through. Invalid or missing `SN` →
       `res.status(400).type('text/plain').send('ERROR: SN requerido')`.
     - A helper that turns `DeviceNotAllowedError` into `res.status(403).type('text/plain').send('ERROR: dispositivo no autorizado')`.
     - `GET /iclock/cdata` → `recordDeviceContact` with `kind: 'handshake'`. On ok,
       `admsOptionsResponse(SN)`.
     - `POST /iclock/cdata` → `table` = query `table` or `''`, body = `req.body` if it is a
       string, else `''`. `parseAdmsBody` → `recordDevicePush`. On ok, `OK: <accepted>`.
     - `GET /iclock/getrequest` → contact `poll`, respond `OK`.
     - `POST /iclock/devicecmd` → contact `command-result`, respond `OK`.
     - `router.all('/iclock/*splat', …)` (Express 5 wildcard syntax; check
       `apps/api/node_modules/express` docs if unsure), registered **last** → contact `unknown`,
       respond `OK`.
     - `bodyLength` = string length of the body (0 if none). All success responses use
       `type('text/plain')`.
   - Observable result: typecheck passes.

7. **Module registration and composition root**
   - Files: `apps/api/src/modules/attendance/attendance.module.ts` (create), `apps/api/src/modules/attendance/index.ts` (create), `apps/api/src/container.ts` (modify)
   - Do: `AttendanceCradle { allowedDeviceSerials: readonly string[]; recordDeviceContact: RecordDeviceContact; recordDevicePush: RecordDevicePush }`.
     `attendanceModule: AppModule<AttendanceCradle>` with `name: 'attendance'`. Registrations:
     `allowedDeviceSerials: asFunction(({ env }: { env: Env }) => env.ZKTECO_ALLOWED_SERIALS).singleton()`
     (so tests can override with `asValue`), plus both commands `asClass(...).singleton()`.
     `deviceRouter: createZktecoAdmsRouter`, no `router`. `index.ts` exports only
     `attendanceModule` and `AttendanceCradle` (public API comment as `organization/index.ts:1-4`).
     In `container.ts`, append `attendanceModule` to `modules` (line 36) and `AttendanceCradle` to
     `Cradle` (line 52).
   - Observable result: `pnpm --filter @rrhh/api test` passes, including `tests/container.test.ts`.

8. **Test double for the logger**
   - Files: `apps/api/src/shared/testing/fakes.ts` (modify)
   - Do: append `RecordingLogger implements Logger` storing
     `entries: { level: 'debug' | 'info' | 'warn' | 'error'; obj: object; msg?: string }[]`.
     Style as `RecordingEventBus` (`fakes.ts:30-45`).
   - Observable result: typecheck passes. The class is available to the tester.

9. **ADR, registry and device runbook**
   - Files: `docs/adr/0008-endpoints-de-dispositivos-fuera-de-contratos.md` (create), `docs/adr/README.md` (modify), `docs/harness/modules.json` (modify), `docs/integraciones/zkteco-senseface-2a.md` (create)
   - Do:
     - ADR 0008 (Spanish, template `docs/adr/0000-plantilla.md`, Estado: Aceptado, 2026-09-28).
       Physical devices speaking their own protocol get routes via `AppModule.deviceRouter`, at
       the root, outside `@rrhh/contracts`/`bindRoute`. Reasons: the protocol is text/plain, and
       no web/mobile consumer exists. Conditions: authentication by device serial allowlist,
       redaction of personal data in logs, no business logic in the router. Alternatives: text
       mode in `bindRoute`, and the pull SDK.
     - Add row `0008` to the table in `docs/adr/README.md`.
     - `modules.json`: `attendance.status` → `active`. Summary becomes
       `"Marcaciones, turnos, jornadas, horas extra. Legal requirements apply. Today: ZKTeco ADMS probe (log only)."`.
     - Runbook (Spanish): purpose and limits of the probe; how to set `ZKTECO_ALLOWED_SERIALS` in
       the local `.env` (by variable name only); that the API listens on `PORT` and the device
       must reach the dev machine's LAN IP (firewall); pointing the device at it (firmware
       `ZAM70-NF24HA-Ver3.3.12`, menu "Modo servidor ADMS": "Habilitar nombre de dominio" off,
       "Dirección del servidor" = LAN IP, the port = `PORT`, "Habilitar servidor proxy" off); a `curl` simulation of the handshake and of an `ATTLOG` post using a fake SN and
       synthetic data; what to look for in the logs (`zkteco:` messages, `LOG_LEVEL=debug` for
       per-record lines); and the reminder that templates are never logged.
   - Observable result: `pnpm plans:lint` and `pnpm check` pass.

10. **Review repair (added 2026-09-28, deviations 6–7, approved by the user)**
    - Files: `apps/api/src/config/env.test.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (create), `apps/api/src/modules/attendance/domain/device-record.test.ts` (create), `apps/api/src/modules/attendance/http/zkteco-adms.parser.test.ts` (create), `apps/api/tests/zkteco-adms.test.ts` (create), `AGENTS.md` (modify), `docs/conventions.md` (modify), `docs/architecture.md` (modify)
    - Do:
      - M1: the test files above, written in the tester phase, are declared here.
      - M2: point `AGENTS.md` rule 5, `docs/conventions.md` (DRY → Contratos) and
        `docs/architecture.md` (overview diagram) to the ADR 0008 exception. Also mark `attendance`
        as a probe in the diagram.
      - L1: in `device-record.ts`, `isDeviceIdentifier` (`^[A-Za-z][A-Za-z0-9_]{0,31}$`). In
        `zkteco-adms.parser.ts`, a line whose prefix or any key fails it becomes `unparsed`,
        and that includes `options` lines.
      - L2: in `app.ts`, device routers are mounted before `express.json`, so `/iclock` bodies
        are always read as text.
      - L3: `RecordDevicePush` reads `input.records` only after the allowlist check. The router
        passes `records` as a getter, so an unauthorized body is never parsed.
    - Observable result: `pnpm check` and `pnpm plans:scope` green.

## Acceptance criteria

- [ ] With `ZKTECO_ALLOWED_SERIALS=TESTSN001`, `curl 'http://localhost:3001/iclock/cdata?SN=TESTSN001&options=all'`
      returns 200, `text/plain`, first line `GET OPTION FROM: TESTSN001`, and the log has
      `zkteco: contacto del dispositivo`.
- [ ] `POST /iclock/cdata?SN=TESTSN001&table=ATTLOG` with body
      `1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n2\t2026-09-28 08:02:00\t0\t15\t0\t0\t0\t0\t0\t0\t\n`
      (observed shape) returns `OK: 2`. The log has one `zkteco: datos recibidos` entry with
      `total: 2`, and at debug level, two `attendance` records with `pin` `1` and `2`.
- [ ] `POST /iclock/cdata?SN=TESTSN001&table=BIODATA` with a synthetic
      `BIODATA Pin=1\tNo=6\tIndex=0\tValid=1\tDuress=0\tType=1\tMajorVer=13\tMinorVer=0\tFormat=0\tTmp=<100 synthetic chars>`
      line returns `OK: 1`. The logged record shows `Tmp` as `[redactado:100]` and `Pin`, `No`,
      `Type`, `Valid` in clear. No log line contains the synthetic template.
- [ ] `POST …&table=OPERLOG` with a synthetic `USER PIN=1\tName=Prueba\tPri=0\tPasswd=1234\tCard=\tGrp=1`
      line and an `OPLOG 7\t0\t2026-09-28 10:47:19\t1\t0\t0\t0` line returns `OK: 2`. `Name` and
      `Passwd` are redacted, and the `OPLOG` line is logged as `operation` with `code: '7'`.
- [ ] `POST …&table=options` with `~DeviceName=SenseFace 2A,MAC=00:00:00:00:00:01,Vendor=ACME CO., LTD.,FWVersion=X-1`
      returns `OK: 1`. `DeviceName` and `FWVersion` are in clear, and the comma inside the vendor
      value does not create a spurious key.
- [ ] Any `/iclock/*` request with an SN not in the allowlist, or with an empty allowlist, returns
      403 `ERROR: dispositivo no autorizado` and logs `zkteco: dispositivo no autorizado`. A
      missing `SN` returns 400.
- [ ] `GET /iclock/getrequest?SN=TESTSN001` and `POST /iclock/devicecmd?SN=TESTSN001` return `OK`.
      `GET /iclock/registry?SN=TESTSN001` (unknown path) returns `OK` and logs `kind: 'unknown'`.
- [ ] Existing `/api/v1/*` and `/health/*` behaviour is unchanged (existing http tests green).
- [ ] **Real device** (verifier with the user and the SenseFace 2A): the device shows as connected
      to the server, a real marcación produces a `zkteco: datos recibidos` log, and fingerprint
      **and face** enrolments produce logs with redacted `Tmp` / `Content` fields (`BIODATA`,
      `BIOPHOTO`, `USERPIC`). NOT VERIFIED if the device isn't available.
- [ ] `POST …&table=OPERLOG` with a synthetic `BIOPHOTO PIN=1\tNo=0\tIndex=0\tFileName=1.jpg\tType=9\tSize=200\tContent=<200 synthetic chars>`
      line returns `OK: 1`. `Content` and `FileName` are redacted, and `PIN`, `Type`, `Size` are
      in clear.
- [ ] `pnpm check` passes.

## Test layers required

| Layer       | Applies | Focus                                                                                                     |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `redactDeviceFields`: allowlisted short values kept, long values and non-allowlisted keys redacted        |
| application | yes     | both commands: allowed / not allowed / empty allowlist; log levels and summary counts (`RecordingLogger`) |
| contract    | no      | no contracts change                                                                                       |
| http        | yes     | parser unit tests; supertest on `/iclock/*` with `allowedDeviceSerials` overridden via `asValue`          |
| integration | no      | no infrastructure / Prisma                                                                                |
| e2e         | no      | (no e2e infrastructure yet)                                                                               |

## Deviations

Implemented 2026-09-28, inline in the main session, on branch `feat/attendance-sonda-zkteco`.

1. **Approval (process).** The user approved in chat ("implementa el plan inline", 2026-09-28).
   The frontmatter went from `draft` straight to `implementing`, without a separate `approved`
   edit.
2. **Plan `Files:` lines (cosmetic, plan only).** Steps 3, 4, 7 and 9 had their paths wrapped
   onto continuation lines. `declaredFiles` (`scripts/plans/lib.mjs:185-197`) reads only the line
   containing `Files:`, so `pnpm plans:scope` flagged 5 declared files as out of scope. The
   continuation lines were joined, and scope is now green (18 declared, 20 changed, 0 out of
   scope).
3. **Extra exported types (cosmetic).**
   - `DeviceContactKind` is exported from `record-device-contact.command.ts`, so the router can
     type its handler factory.
   - `LogLevel` is exported from `fakes.ts` next to `RecordingLogger`.
4. **`override` on the error `code`.** Follows the existing module convention
   (`apps/api/src/modules/employees/domain/errors.ts:20`); the plan did not mention it.
5. **Running-app smoke test NOT done.** Starting the API with inline env vars
   (`PORT=… ZKTECO_ALLOWED_SERIALS=… pnpm dev:api`) is blocked by `guard-bash`, and `.env` may not
   be edited. The acceptance criteria against the running app are left to the verifier (the user
   sets `ZKTECO_ALLOWED_SERIALS` in their local `.env`).

`pnpm check` green on 2026-09-28: api 39 tests, arch:check with no violations (97 modules),
plans:lint, harness:check, and test:harness 156/156.

**Repair after review (2026-09-28).** The review (see `## Review findings`) left the plan in
`review` with M1, M2, L1, L2 and L3. On the user's decision, the main session moved it
review → implementing and applied every one of them inline. It returns to `testing`: the tester
must add regression tests for L1–L3. The previous review stays below as history. It is superseded
for the repaired code.

6. **Scope extension (approved by the user).** Step 10 declares the tester's 6 files (M1) and 3
   docs outside the original list (M2): `AGENTS.md`, `docs/conventions.md` and
   `docs/architecture.md`. Deviation 2's "0 out of scope" was valid only before the test commit.
7. **Hardening beyond the original design (L1–L3).** The plan said redaction "keeps every key",
   and step 5 did not bound prefixes. Both are now restricted to identifiers. The user chose L2
   as "warn when the body is not text". Instead, the device routers were mounted before
   `express.json`, which removes the cause: every `/iclock` body is parsed as text, and a JSON
   `Content-Type` is no longer lost. The L3 getter keeps the `RecordDevicePush` input type
   unchanged (`readonly records`), so the existing tests stay valid.

`pnpm --filter @rrhh/api` typecheck, lint and test (85) are green after the repair. Full
`pnpm check` is below, in the closing run.

## Test coverage

Baseline (`pnpm check`, 2026-09-28, before writing tests): green, api 39 tests — matches the
`Deviations` note. Closing run: green, api 85 tests (+46), `arch:check` 102 modules / 287
dependencies, `plans:lint`/`harness:check`/`test:harness` unchanged (156/156).

| Behavior (from plan / code)                                                                                                                | Source (`file:line`)                                                       | Layer                    | Test                                                                                                                                                                     | State                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ZKTECO_ALLOWED_SERIALS` se parte por coma, se recorta y filtra vacíos; vacío → `[]`                                                       | `apps/api/src/config/env.ts:25-33`                                         | domain                   | `src/config/env.test.ts › transforma…`, `› produce un arreglo vacío…`, `› descarta segmentos vacíos`                                                                     | CONFIRMED                                                                                                                          |
| `redactDeviceFields`: clave permitida y valor ≤64 se conserva                                                                              | `apps/api/src/modules/attendance/domain/device-record.ts:55-64`            | domain                   | `device-record.test.ts › conserva un valor corto…`, `› conserva … exactamente 64…`                                                                                       | CONFIRMED                                                                                                                          |
| `redactDeviceFields`: comparación exacta (`PIN` ≠ `Pin`)                                                                                   | `device-record.ts:27,60`                                                   | domain                   | `device-record.test.ts › distingue PIN de Pin…`                                                                                                                          | CONFIRMED                                                                                                                          |
| `redactDeviceFields`: clave no permitida o valor >64 → `[redactado:<largo>]`, sin filtrar claves                                           | `device-record.ts:58-64`                                                   | domain                   | `device-record.test.ts › redacta una clave no permitida…`, `› redacta un valor permitido si supera…`, `› conserva todas las claves…`, `› nunca deja pasar el contenido…` | CONFIRMED                                                                                                                          |
| Lista de campos permitidos excluye `Name/Passwd/Card/ViceCard/Tmp/MAC`                                                                     | `device-record.ts:28-49`                                                   | domain                   | `device-record.test.ts › excluye deliberadamente…`                                                                                                                       | CONFIRMED                                                                                                                          |
| `parseAdmsBody('options', …)`: separador tolera comas dentro del valor                                                                     | `zkteco-adms.parser.ts:16,22-31`                                           | http                     | `zkteco-adms.parser.test.ts › interpreta una línea table=options…`, `› es insensible a mayúsculas…`                                                                      | CONFIRMED                                                                                                                          |
| `parseAdmsBody('ATTLOG', …)`: posicional, tab final descartado                                                                             | `zkteco-adms.parser.ts:17,33-40`                                           | http                     | `zkteco-adms.parser.test.ts › interpreta dos líneas ATTLOG…`, `› descarta líneas vacías…`                                                                                | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: ATTLOG sin PIN/hora → `unparsed`                                                                                          | `zkteco-adms.parser.ts:38`                                                 | http                     | `zkteco-adms.parser.test.ts › marca una línea ATTLOG sin PIN…`                                                                                                           | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: `OPLOG <código>\t<pin>\t<hora>\t<objetos>` → `operation`                                                                  | `zkteco-adms.parser.ts:48-55`                                              | http                     | `zkteco-adms.parser.test.ts › interpreta una línea OPLOG…`                                                                                                               | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: `USER ...` → `entry` con campos redactados                                                                                | `zkteco-adms.parser.ts:57-63`                                              | http                     | `zkteco-adms.parser.test.ts › interpreta una línea USER…`                                                                                                                | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: `BIODATA ...` → `entry`, `Tmp` redactado, resto en claro                                                                  | `zkteco-adms.parser.ts:57-63`, `device-record.ts:55-64`                    | http                     | `zkteco-adms.parser.test.ts › interpreta una línea BIODATA…`                                                                                                             | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: `BIOPHOTO ...` → `entry`, `Content`/`FileName` redactados                                                                 | `zkteco-adms.parser.ts:57-63`                                              | http                     | `zkteco-adms.parser.test.ts › interpreta una línea BIOPHOTO…`                                                                                                            | CONFIRMED                                                                                                                          |
| `parseAdmsBody`: línea sin espacio ni `clave=valor` → `unparsed`, sin exponer el crudo                                                     | `zkteco-adms.parser.ts:44,60,73-75`                                        | http                     | `zkteco-adms.parser.test.ts › marca como no interpretada…`, `› nunca incluye el contenido crudo…`                                                                        | CONFIRMED                                                                                                                          |
| `admsOptionsResponse`: primera línea `GET OPTION FROM: <SN>`, incluye `Delay=10`                                                           | `zkteco-adms.parser.ts:82-96`                                              | http                     | `zkteco-adms.parser.test.ts › arma el bloque de opciones…`                                                                                                               | CONFIRMED                                                                                                                          |
| `RecordDeviceContact`: SN fuera de la lista → `err(DeviceNotAllowedError)`, `logger.warn`                                                  | `record-device-contact.command.ts:39-42`                                   | application              | `record-device-contact.command.test.ts › rechaza un número de serie…`                                                                                                    | CONFIRMED                                                                                                                          |
| `RecordDeviceContact`: lista vacía rechaza todo                                                                                            | `record-device-contact.command.ts:39`                                      | application              | `record-device-contact.command.test.ts › rechaza cualquier equipo…`                                                                                                      | CONFIRMED                                                                                                                          |
| `RecordDeviceContact`: `kind: 'poll'` → `logger.debug`; otro → `logger.info`                                                               | `record-device-contact.command.ts:45-46`                                   | application              | `record-device-contact.command.test.ts › registra a nivel info…`, `› registra a nivel debug…`                                                                            | CONFIRMED                                                                                                                          |
| `RecordDevicePush`: SN fuera de la lista → `err`, `logger.warn`, sin loggear registros                                                     | `record-device-push.command.ts:36-39`                                      | application              | `record-device-push.command.test.ts › rechaza un número de serie…`                                                                                                       | CONFIRMED                                                                                                                          |
| `RecordDevicePush`: lista vacía rechaza todo                                                                                               | `record-device-push.command.ts:36`                                         | application              | `record-device-push.command.test.ts › rechaza cualquier equipo…`                                                                                                         | CONFIRMED                                                                                                                          |
| `RecordDevicePush`: `ok({ accepted: records.length })`                                                                                     | `record-device-push.command.ts:49`                                         | application              | `record-device-push.command.test.ts › acepta y devuelve el conteo…`, `› no registra el detalle…`                                                                         | CONFIRMED                                                                                                                          |
| `RecordDevicePush`: resumen `info` con `byKind` (por `kind`, `entry` por `prefix`)                                                         | `record-device-push.command.ts:41-44,54-61`                                | application              | `record-device-push.command.test.ts › registra un resumen…`, `› cuenta los registros entry…`                                                                             | CONFIRMED                                                                                                                          |
| `RecordDevicePush`: un `logger.debug` por registro                                                                                         | `record-device-push.command.ts:45-47`                                      | application              | `record-device-push.command.test.ts › registra cada registro individual…`                                                                                                | CONFIRMED                                                                                                                          |
| `GET /iclock/cdata` handshake → 200 `text/plain`, `GET OPTION FROM: <SN>`, log info                                                        | `zkteco-adms.router.ts:54`, `zkteco-adms.parser.ts:82-96`                  | http                     | `tests/zkteco-adms.test.ts › responde el bloque de opciones…`                                                                                                            | CONFIRMED                                                                                                                          |
| `POST /iclock/cdata?table=ATTLOG` → `OK: <n>`, resumen + detalle en el log                                                                 | `zkteco-adms.router.ts:56-70`                                              | http                     | `tests/zkteco-adms.test.ts › acepta dos marcaciones ATTLOG…`                                                                                                             | CONFIRMED                                                                                                                          |
| `POST /iclock/cdata?table=BIODATA` → `OK: 1`, `Tmp` redactado, plantilla nunca en el log                                                   | `zkteco-adms.router.ts:56-70`, `zkteco-adms.parser.ts`, `device-record.ts` | http                     | `tests/zkteco-adms.test.ts › acepta un registro BIODATA…`                                                                                                                | CONFIRMED                                                                                                                          |
| `POST /iclock/cdata?table=OPERLOG` con `BIOPHOTO` → `Content`/`FileName` redactados                                                        | ídem                                                                       | http                     | `tests/zkteco-adms.test.ts › acepta una línea BIOPHOTO…`                                                                                                                 | CONFIRMED                                                                                                                          |
| `POST /iclock/cdata?table=OPERLOG` con `USER`+`OPLOG` → `OK: 2`, redacción, `operation`                                                    | ídem                                                                       | http                     | `tests/zkteco-adms.test.ts › acepta USER y OPLOG…`                                                                                                                       | CONFIRMED                                                                                                                          |
| `POST /iclock/cdata?table=options` con coma en el valor → sin clave espuria                                                                | `zkteco-adms.parser.ts:22-31`                                              | http                     | `tests/zkteco-adms.test.ts › interpreta table=options…`                                                                                                                  | CONFIRMED                                                                                                                          |
| SN no permitido → 403 `ERROR: dispositivo no autorizado`, `logger.warn`                                                                    | `zkteco-adms.router.ts:47-51,114-116`                                      | http                     | `tests/zkteco-adms.test.ts › responde 403 y registra warn…`                                                                                                              | CONFIRMED                                                                                                                          |
| Lista permitida vacía → 403 para cualquier SN                                                                                              | `record-device-contact.command.ts:39`, `zkteco-adms.router.ts`             | http                     | `tests/zkteco-adms.test.ts › responde 403 para cualquier SN…`                                                                                                            | CONFIRMED                                                                                                                          |
| `SN` ausente/ inválido → 400 `ERROR: SN requerido`                                                                                         | `zkteco-adms.router.ts:89-94`                                              | http                     | `tests/zkteco-adms.test.ts › responde 400 si falta el SN`                                                                                                                | CONFIRMED                                                                                                                          |
| `GET /iclock/getrequest` y `POST /iclock/devicecmd` → `OK`                                                                                 | `zkteco-adms.router.ts:72-79`                                              | http                     | `tests/zkteco-adms.test.ts › getrequest y devicecmd responden OK`                                                                                                        | CONFIRMED                                                                                                                          |
| Ruta desconocida bajo `/iclock` (p. ej. `registry`) → `OK`, `kind: 'unknown'`                                                              | `zkteco-adms.router.ts:81-84`                                              | http                     | `tests/zkteco-adms.test.ts › una ruta desconocida…`                                                                                                                      | CONFIRMED                                                                                                                          |
| `/api/v1/*` y `/health/*` sin cambios de comportamiento                                                                                    | `app.ts:35-45` (existente + `tests/http.test.ts`)                          | http                     | `tests/zkteco-adms.test.ts › el resto de /api/v1 y /health…` + `tests/http.test.ts` (8 tests, sin cambios)                                                               | CONFIRMED                                                                                                                          |
| DI del módulo `attendance` resuelve completo (allowlist, ambos comandos, router)                                                           | `attendance.module.ts`, `container.ts:37,53`                               | http                     | `tests/container.test.ts › …` (verifica todo el cradle, sin tocar)                                                                                                       | CONFIRMED                                                                                                                          |
| **Equipo real**: conectado, marcación real produce `zkteco: datos recibidos`, huella y rostro producen logs con `Tmp`/`Content` redactados | README (captura 2026-09-28)                                                | e2e (dispositivo físico) | —                                                                                                                                                                        | NOT CONFIRMED: requiere el SenseFace 2A real; queda para el verifier con el usuario y el equipo (criterio de aceptación explícito) |

Notas:

- No se agregó capa `contract` ni `integration`: el plan las marca `no` y el código no las toca
  (sin contratos Zod nuevos, sin Prisma/infraestructura).
- `src/config/env.test.ts` no estaba en la tabla "Test layers required" del plan (que solo lista
  domain/application/http), pero el paso 1 declara un resultado observable concreto
  (`loadEnv({…}) → ['A1','B2']`) derivado de código real; se agregó como test de dominio puro
  porque no hay capa de configuración en la matriz y es la más baja que lo valida — no reemplaza
  ninguna capa requerida, la complementa.
- El uso de `RecordingLogger` para los tests HTTP no pudo hacerse reemplazando la clave `logger`
  del cradle completo (usada también por `pino-http`, que exige `.child(...)`); se reemplazaron
  en su lugar `recordDeviceContact`/`recordDevicePush` con instancias construidas con el logger de
  prueba, siguiendo el mismo patrón de override por `asValue` que ya usa `tests/http.test.ts` para
  `companyRepository`/`employeeRepository`.

## Review findings

Reviewed 2026-09-28 (reviewer subagent). Diff `main...HEAD` (commits `6745fee`, `8912401`), working
tree clean.

### Pass 1: checklist (11/13)

- [ ] **FAIL**: `pnpm plans:scope`. Exit 1: 18 declared, 26 changed, 6 out of scope. These are
      the tester's files, and no `Files:` line declares them:
      `apps/api/src/config/env.test.ts`,
      `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts`,
      `.../record-device-push.command.test.ts`, `.../domain/device-record.test.ts`,
      `.../http/zkteco-adms.parser.test.ts`, `apps/api/tests/zkteco-adms.test.ts`. The hot-file
      changes are acceptable. `container.ts` only gains an import, an array element and a `Cradle`
      member. The `modules.json` entry edit is declared in step 9.
- [x] `pnpm check` green: api 85 tests, arch:check with 0 violations (102 modules), plans:lint,
      harness:check, test:harness 156/156, bootstrap and quality.
- [x] `pnpm test:integration`: N/A, since `infrastructure/` and Prisma were not touched.
- [x] Business rules: the redaction allowlist is in `domain/device-record.ts`, and authorization is
      in the commands. The parser only translates wire format. The router has no rules.
- [x] CQRS-lite: two commands return `Result`. There is no aggregate or repository, by design
      (decision 2).
- [x] Contracts: not applicable. The exception is recorded in ADR 0008, and no hand-written DTO
      duplicates a contract.
- [x] Expected errors: `DeviceNotAllowedError` has the stable code `DEVICE_NOT_ALLOWED`. The HTTP
      403 response has no internals.
- [x] Money, dates, ids: not used. The device time is logged raw, as the plan requires.
- [x] Schema and migration: N/A.
- [x] DI: `tests/container.test.ts` is green, and `attendanceModule` is registered once.
- [x] No secrets, `.env` contents or real personal data. SNs, PINs, MACs and names in tests and the
      runbook are synthetic.
- [x] `## Deviations` is honest. Spot-checked: `DeviceContactKind` is exported
      (`record-device-contact.command.ts:8`), and `override` matches
      `employees/domain/errors.ts:20`. The scope claim in Deviation 2 ("0 out of scope") was true
      before the tester's commit, not now.
- [ ] **FAIL**: stale docs. See finding M2.

### Pass 2: findings by severity

**High**: none.

**Medium**

- **M1 — Scope check red (process).** Location: the plan's `Files:` lines (steps 1–9). `pnpm plans:scope` exits 1
  because the 6 test files above are undeclared. Failure scenario: the pipeline's scope gate
  cannot be green for this plan, and the commit of the test phase is not traceable to the plan's
  file list. No product code change is needed. The main session or the user decides how to
  declare the files, for example with a `## Deviations` entry plus a `Files:` line that lists
  them, as the `platform-*` plans do. Scope must then be re-run.
- **M2 — Docs contradict ADR 0008 (stale docs).** Nothing in the plan's file list covers these:
  - `docs/conventions.md:53`: "un endpoint se define una vez en `@rrhh/contracts`".
  - `AGENTS.md` rule 5: "todo endpoint se define en `packages/contracts` … `bindRoute`".
  - `docs/architecture.md:12-17`: the diagram shows HTTP only under `/api/v1` and marks
    `attendance*` as "por construir".

  None of them mention the `deviceRouter` exception. Failure scenario: a later agent follows
  AGENTS.md rule 5 and "fixes" `/iclock/*` into contracts or `bindRoute`. Or a reviewer flags
  ADR 0008 routes as violations. Fix: add a one-line pointer to ADR 0008 in each file. This needs
  those files added to the plan (a deviation plus the user's OK), or a finding in
  `plans/hallazgos/`.

**Low**

- **L1 — Keys and prefixes are never redacted or bounded (uncertain).** Locations:
  `apps/api/src/modules/attendance/domain/device-record.ts:55-64`, `zkteco-adms.parser.ts:42-63`
  and `record-device-push.command.ts:54-61`. `redactDeviceFields` keeps every key verbatim, and
  `entry.prefix` (all text before the first space) is logged verbatim. The prefix is also used as a
  `byKind` key in the **info** summary. Both can be of any length. Failure scenario: a line that
  isn't one of the observed formats but has the shape `<data> <k>=<v>`, or `<data>=<v>`. Two
  examples are a binary `ATTPHOTO` upload (the options block sends `ATTPHOTOStamp=None`) and an
  older firmware sending `PIN=1\tName=Juan …` lines with no prefix. Either case puts raw content
  into the log as a key or prefix, which defeats the "fails closed" intent of decision 3. This
  matches the plan as written ("keeps every key"), so it is a design gap, not an implementation
  error. Uncertain, because no such line was captured. A possible hardening step: accept only
  prefixes and keys that match `^[A-Za-z][A-Za-z0-9_]{0,31}$`, and treat anything else as
  `unparsed`.
- **L2 — Non-text bodies on `/iclock` bypass the text parser (uncertain).** `app.ts:23`
  (`express.json`) runs before the device router. If a device sends a POST with
  `Content-Type: application/json`, the body is parsed there. `express.text` then skips it, and
  `bodyText` returns `''`. The response is `OK: 0`, and the device may then discard data it
  believes we accepted. Malformed JSON, or an oversize body (413 from the 5 MB limit), goes to
  the JSON `errorHandler`/`notFoundHandler` instead of a text reply. Only `text/plain` was
  observed, so this is low risk for the SenseFace 2A.
- **L3 — Parsing happens before authorization.** In `zkteco-adms.router.ts:52-60`,
  `parseAdmsBody` runs on bodies of up to 5 MB before the allowlist check inside
  `RecordDevicePush`. Nothing is logged for unauthorized devices, so there is no data leak. The
  cost is CPU for any unauthenticated client. Rate limiting is out of scope, so this is only a
  note.

**Info**

- `tests/zkteco-adms.test.ts:26-33` replaces both commands with hand-built instances. No HTTP test
  exercises the real path `env.ZKTECO_ALLOWED_SERIALS` → `allowedDeviceSerials` → command.
  `container.test.ts` only proves that the path resolves. The verifier's run against a real
  `.env` covers it.

Status stays `review`. The checklist has 2 failed items (M1, M2). M1 is plan-only. M2 needs a
scope decision. L1–L3 are for the main session and the user to accept or schedule.

## Verification
