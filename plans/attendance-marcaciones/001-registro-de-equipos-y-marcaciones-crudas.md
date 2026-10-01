---
status: verify
module: attendance
min_implementer: mid
depends_on: []
---

# 001 — Device registry and raw marcaciones

## Context

**What exists today** (probe `attendance-sonda-zkteco/001`, `done`):

- The ADMS router answers `/iclock/*` outside `/api/v1` and the contracts (ADR 0008). It validates
  `SN` as 1–64 chars (`apps/api/src/modules/attendance/http/zkteco-adms.router.ts:14-17`), and the
  push handler passes the parsed records to `RecordDevicePush` lazily through a getter and answers
  `OK: <accepted>` (`zkteco-adms.router.ts:56-75`). The other routes call `RecordDeviceContact`
  (`zkteco-adms.router.ts:33-52`, `:54`, `:77-90`).
- Authorization is an env allowlist: `ZKTECO_ALLOWED_SERIALS` (`apps/api/src/config/env.ts:24-33`,
  `apps/api/.env.example:17-19`), registered as `allowedDeviceSerials`
  (`apps/api/src/modules/attendance/attendance.module.ts:19-22`). Both commands check it and log a
  warn on mismatch (`application/commands/record-device-contact.command.ts:39-42`,
  `record-device-push.command.ts:39-42`).
- `RecordDevicePush` only logs: a summary at info and each record at debug, "No persiste nada"
  (`record-device-push.command.ts:24-27`, `:45-52`). `RecordDeviceContact` logs polls at debug,
  the rest at info (`record-device-contact.command.ts:44-46`).
- The parser turns each `ATTLOG` line into
  `{ kind: 'attendance', pin, deviceTime, status, verifyMode, extraFields }`
  (`http/zkteco-adms.parser.ts:21`, `:38-45`). `deviceTime` is the device's local wall time
  `YYYY-MM-DD HH:mm:ss` with no offset (`domain/device-record.ts:35-44`).
- The handshake answers `ATTLOGStamp=None` (`zkteco-adms.parser.ts:93-98`), so the device resends
  its whole history on each handshake: storage must be idempotent.
- Observed on the real SenseFace 2A: fingerprint marcación `pin "2"`, `deviceTime
"2026-09-28 12:17:29"`, `verifyMode "1"`; face marcaciones `verifyMode "15"`; device time is
  UTC−5 (Cancún) (`plans/attendance-sonda-zkteco/001-recepcion-adms-solo-log.md:720-723`).
- No `attendance` schema exists: `datasource.schemas` is `["organization", "employees", "identity"]`
  (`apps/api/prisma/schema.prisma:19`). Rules: one schema per module, no FK across modules, snake_case
  tables (`schema.prisma:4-9`).
- Permissions are a closed list (`packages/domain/src/identity/access.ts:6-18`). HOLDING_ADMIN gets
  all of them; HR gets a fixed list (`apps/api/src/modules/identity/domain/role-catalog.ts:15-26`).
  A route without `companyParam` passes if the actor holds the permission for any company or the
  holding (`apps/api/src/http/bind-route.ts:83-86`, `apps/api/src/shared/application/actor.ts:20-26`);
  `companiesWith` returns `'ALL'` only for a holding-wide grant (`actor.ts:32-40`).
- No time-zone helper exists in `packages/domain/src` (files: `country`, `date-range`, `money`,
  `national-id`, `tax-id`, … per `packages/domain/src/index.ts:1-14`) and the API has no date
  library (`apps/api/package.json:25-42`). Node is v24.

**What we need** (README decisions 2–6): a database registry of devices (serial, name, IANA time
zone, active) that replaces the env allowlist; every ATTLOG marcación stored once with its raw
local time and its UTC instant; the device's last contact; and two read endpoints in the contracts.

**Approach.** Two aggregates in `attendance`: `Device` (registered by an admin, seen by the
device router) and `Punch` (one stored marcación, created from a device record and the device's
time zone). Considered alternative: a single "device log" table storing every pushed record as
JSON. Rejected: it pushes parsing and deduplication into every reader, and README decision 6
forbids storing the biometric records anyway. Deduplication is the unique index
`(device_id, pin, device_local_time)` with `createMany({ skipDuplicates: true })`: the device
resends history (see `Stamp=None` above), and the same PIN cannot mark twice in the same second
on one device. Local → UTC conversion uses `Intl.DateTimeFormat` (no dependency); it lives in
`packages/domain` because the contract validates the time zone with the same rule (as
`CreateCompanySchema` does with `TaxId`, `packages/contracts/src/organization/company.contract.ts:21-32`).
`lastSeenAt` is written at most once per minute (`Device.markSeen`), because the device polls
every ~10 s (`Delay=10`, `zkteco-adms.parser.ts:100`); writing the punches and `lastSeenAt` is
not transactional on purpose: `lastSeenAt` is best-effort status, a lost update is harmless.

**Files imitated** (copy their shape by name):

- Aggregate: `apps/api/src/modules/organization/domain/company.ts:27-66` (private props,
  `create`/`restore`, event recorded on create).
- Errors: `apps/api/src/modules/organization/domain/errors.ts:1-17`; existing
  `apps/api/src/modules/attendance/domain/errors.ts:1-9`.
- Command: `apps/api/src/modules/organization/application/commands/create-company.command.ts:20-52`.
- Query port + use case with actor filtering:
  `apps/api/src/modules/organization/application/queries/company.queries.ts:7-11`,
  `list-companies.query.ts:22-28`.
- Prisma adapters and mapper: `apps/api/src/modules/organization/infrastructure/prisma-company.repository.ts:118-149`,
  `prisma-company.queries.ts:37-75`, `company.mapper.ts:116-153`.
- In-memory store shared by repository and queries:
  `apps/api/src/modules/organization/infrastructure/in-memory/in-memory-company.store.ts:14-71`.
- Contract: `packages/contracts/src/organization/company.contract.ts:1-64`; catalog
  `packages/contracts/src/index.ts:1-26`.
- Router: `apps/api/src/modules/organization/http/organization.router.ts:86-106`.
- Module registration: `apps/api/src/modules/employees/employees.module.ts:40-60`.
- Integration test: `apps/api/tests/integration/organization/prisma-company.int.test.ts:1-40`.

## Out of scope

- Linking a PIN to a colaborador, and HR access to punches (plan 002, README decisions 4–5).
- Deactivating, renaming or deleting a device through the API (the `active` column exists; the
  endpoint does not). Rejecting an inactive device IS in scope.
- Persisting `OPLOG`, `USER`, `BIODATA`, `BIOPHOTO`, `USERPIC`, `options`: they stay log-only
  exactly as today (README decision 6).
- Sending commands to the device; changing the handshake (`Stamp=None` stays) or any ADMS response
  text, including `OK: <n>`.
- Recording contacts from unregistered serials anywhere but the existing warn log.
- Web or mobile screens. The seed (`apps/api/prisma/seed.ts`).
- Shifts, jornadas, overtime, LFT rules, clock-skew detection on device times.
- Refactoring the parser, ADR 0008 or the probe's tests beyond what Step 7 lists.

## Dependencies

None. (Builds on `attendance-sonda-zkteco/001`, which is `done`.)

## Steps

1. **Time-zone helpers in the shared kernel**
   - Files: `packages/domain/src/time-zone.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do: export two pure functions, docblocks in Spanish.
     - `isValidTimeZone(timeZone: string): boolean` — `true` iff
       `new Intl.DateTimeFormat('en-US', { timeZone })` does not throw.
     - `localDateTimeToUtc(local: string, timeZone: string): Result<Date, InvalidValueError>` —
       `local` must match `/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/` and be a real
       calendar time (build `Date.UTC(y, m - 1, d, h, mi, s)` and require that its UTC
       year/month/day/hour/minute/second equal the parsed ones); otherwise
       `err(new InvalidValueError('Fecha y hora del equipo inválida'))`. Invalid zone →
       `err(new InvalidValueError('Zona horaria inválida'))`. Conversion: `naive` = that `Date.UTC`
       value; `offsetAt(ms)` = (wall time of `new Date(ms)` in `timeZone`, read with
       `formatToParts` using `hourCycle: 'h23'` and 2-digit year/month/day/hour/minute/second,
       reassembled with `Date.UTC`) − `ms`; `first = naive − offsetAt(naive)`;
       result `new Date(naive − offsetAt(first))`.
     - Add `export * from './time-zone';` to `index.ts` in alphabetical position.
   - Observable result: `localDateTimeToUtc('2026-09-28 12:17:29', 'America/Cancun')` returns
     `2026-09-28T17:17:29.000Z`; `isValidTimeZone('Mars/Olympus')` is `false`.

2. **Permissions and role catalog**
   - Files: `packages/domain/src/identity/access.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify)
   - Do: append to `PERMISSIONS` (after `employees:register`): `'attendance.devices:read'`,
     `'attendance.devices:manage'`, `'attendance.punches:read'`. Add only
     `'attendance.devices:read'` to HR's list, with a comment citing README decision 5 of
     `attendance-marcaciones` (raw punches have no company until plan 002). HOLDING_ADMIN gets the
     three automatically (`role-catalog.ts:15`). In the test: add `'attendance.devices:read'` to
     the expected HR list (`role-catalog.test.ts:22-30`) and change `toHaveLength(5)` to
     `toHaveLength(6)` (`:63`). No other test change.
   - Observable result: `pnpm --filter @rrhh/api test role-catalog` passes.

3. **Contracts**
   - Files: `packages/contracts/src/attendance/device.contract.ts` (create), `packages/contracts/src/attendance/punch.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do, `device.contract.ts`:
     - `DeviceSchema` (`.meta({ id: 'AttendanceDevice' })`): `id: z.uuid()`,
       `serialNumber: z.string()`, `name: z.string()`, `timeZone: z.string()`,
       `active: z.boolean()`, `registeredAt: z.iso.datetime()`,
       `lastSeenAt: z.iso.datetime().nullable()`, `lastPunchAt: z.iso.datetime().nullable()`.
       Export `type DeviceDto`.
     - `RegisterDeviceSchema` (`.meta({ id: 'RegisterAttendanceDeviceInput' })`):
       `serialNumber: z.string().trim().regex(/^[A-Za-z0-9]{1,64}$/)`,
       `name: z.string().trim().min(1).max(100)`,
       `timeZone: z.string().trim().refine(isValidTimeZone, 'Zona horaria inválida')`
       (`isValidTimeZone` from `@rrhh/domain`). Export `type RegisterDeviceInput` (`z.input`).
     - `attendanceDeviceRoutes = { listDevices, registerDevice }`:
       `listDevices`: `GET /attendance/devices`, summary `'Checadores registrados y su último contacto'`,
       `access: requires('attendance.devices:read')`, `query: PageQuerySchema`,
       `response: pageOf(DeviceSchema)`.
       `registerDevice`: `POST /attendance/devices`, summary `'Registra un checador autorizado'`,
       `access: requires('attendance.devices:manage')`, `body: RegisterDeviceSchema`,
       `response: CreatedSchema`, `successStatus: 201`.
   - Do, `punch.contract.ts`:
     - `PunchSchema` (`.meta({ id: 'AttendancePunch' })`): `id: z.uuid()`, `deviceId: z.uuid()`,
       `serialNumber: z.string()`, `pin: z.string()`,
       `occurredAt: z.iso.datetime()` `.describe('Instante UTC de la marcación')`,
       `deviceLocalTime: z.string()` `.describe('Hora local del equipo tal como llegó, YYYY-MM-DD HH:mm:ss')`,
       `status: z.string()`, `verifyMode: z.string()`, `receivedAt: z.iso.datetime()`.
       Export `type PunchDto`.
     - `ListPunchesQuerySchema = PageQuerySchema.extend({ deviceId: z.uuid().optional(),
pin: z.string().trim().min(1).max(32).optional(), from: z.iso.datetime().optional(),
to: z.iso.datetime().optional() })`; export `type ListPunchesQuery` (`z.output`).
     - `attendancePunchRoutes = { listPunches }`: `GET /attendance/punches`, summary
       `'Marcaciones crudas recibidas de los checadores'`,
       `access: requires('attendance.punches:read')`, `query: ListPunchesQuerySchema`,
       `response: pageOf(PunchSchema)`.
   - `index.ts`: `export *` both files (alphabetical, before `./common`… keep the file's ordering
     style), import both route objects and add `attendanceDevices: attendanceDeviceRoutes,
attendancePunches: attendancePunchRoutes` to `apiRoutes`.
   - Regenerate the snapshot: `pnpm --filter @rrhh/contracts openapi`
     (`packages/contracts/package.json:15`).
   - Observable result: `pnpm --filter @rrhh/contracts test` passes and `openapi.json` contains
     `/attendance/devices` and `/attendance/punches`.

4. **Domain: `Device` and `Punch`**
   - Files: `apps/api/src/modules/attendance/domain/device.ts` (create), `apps/api/src/modules/attendance/domain/device.repository.ts` (create), `apps/api/src/modules/attendance/domain/punch.ts` (create), `apps/api/src/modules/attendance/domain/punch.repository.ts` (create), `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do, `device.ts` (shape of `company.ts:27-66`):
     - `DeviceId = Id<'Device'>`; props `serialNumber`, `name`, `timeZone`, `active`,
       `registeredAt: Date`, `lastSeenAt: Date | null`.
     - `DEVICE_REGISTERED = 'attendance.device.registered'`.
     - `export const DEVICE_SEEN_RESOLUTION_MS = 60_000` with a docblock: the device polls every
       ~10 s, so `lastSeenAt` is only rewritten when a minute has passed.
     - `static register({ id, serialNumber, name, timeZone, now })` →
       `Result<Device, InvalidValueError>`: trims; serial must match `/^[A-Za-z0-9]{1,64}$/`
       (`'Número de serie inválido'`); name 1–100 chars (`'El nombre del equipo es obligatorio'`
       / `'El nombre del equipo es demasiado largo'`); `isValidTimeZone` (`'Zona horaria inválida'`).
       Starts `active: true`, `lastSeenAt: null`; records `DEVICE_REGISTERED` with
       `{ deviceId, serialNumber }`.
     - `static restore(id, props)`; getters for every prop.
     - `markSeen(now: Date): boolean` — sets `lastSeenAt = now` and returns `true` when
       `lastSeenAt` is `null` or `now − lastSeenAt ≥ DEVICE_SEEN_RESOLUTION_MS`; otherwise returns
       `false` and changes nothing.
   - Do, `device.repository.ts`: `DeviceRepository { findById(id), findBySerialNumber(serial):
Promise<Device | null>; save(device): Promise<Result<void, DeviceAlreadyRegisteredError>> }`
     (shape of `apps/api/src/modules/employees/domain/employee.repository.ts:1-11`).
   - Do, `punch.ts`: `PunchId = Id<'Punch'>`; `Punch extends Entity<PunchId>` (no events, no
     state changes) with props `deviceId`, `pin`, `deviceLocalTime`, `occurredAt`, `status`,
     `verifyMode`, `receivedAt`, getters, and
     `static fromDevice({ id, deviceId, timeZone, pin, deviceTime, status, verifyMode, receivedAt })`
     → `Result<Punch, InvalidValueError>`: `pin` non-empty, ≤ 32 chars, no whitespace
     (`'PIN de marcación inválido'`); `status` and `verifyMode` ≤ 16 chars
     (`'Marcación con campos demasiado largos'`); `occurredAt` from
     `localDateTimeToUtc(deviceTime, timeZone)` (propagate its error); `deviceLocalTime =
deviceTime`. Plus `static restore(id, props)`.
   - Do, `punch.repository.ts`: `PunchRepository { saveNew(punches: readonly Punch[]):
Promise<{ inserted: number }> }` with a docblock: duplicates by
     `(deviceId, pin, deviceLocalTime)` are skipped silently, not an error.
   - Do, `errors.ts`: add `DeviceAlreadyRegisteredError extends ConflictError`, code
     `'DEVICE_ALREADY_REGISTERED'`, message `'Ya existe un equipo con ese número de serie'`,
     details `{ serialNumber }`. Keep `DeviceNotAllowedError` unchanged.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes.

5. **Application: commands and queries**
   - Files: `apps/api/src/modules/attendance/application/commands/register-device.command.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify), `apps/api/src/modules/attendance/application/queries/attendance.queries.ts` (create), `apps/api/src/modules/attendance/application/queries/list-devices.query.ts` (create), `apps/api/src/modules/attendance/application/queries/list-punches.query.ts` (create)
   - Do, `RegisterDevice` (shape of `create-company.command.ts:20-52`): deps
     `deviceRepository, idGenerator, clock, eventBus`. If `findBySerialNumber(trimmed serial)` is
     not null → `err(new DeviceAlreadyRegisteredError(serial))`. `Device.register` → `save` →
     publish events → `ok({ id })`.
   - Do, `RecordDeviceContact`: replace dep `allowedDeviceSerials` with `deviceRepository` and
     `clock`. `device = await findBySerialNumber(serialNumber)`; if `null` or `!device.active` →
     same warn log and `DeviceNotAllowedError` as today. Otherwise: if
     `device.markSeen(clock.now())` then `await deviceRepository.save(device)`; then the same
     debug/info logs as today. Update the class docblock (no longer "No persiste nada").
   - Do, `RecordDevicePush`: deps `logger, deviceRepository, punchRepository, idGenerator, clock`.
     Same not-registered/inactive check and warn as above. Keep the info summary and per-record
     debug logs unchanged. Then, only when `table.toUpperCase() === 'ATTLOG'`: for each record of
     kind `'attendance'` build `Punch.fromDevice` with `idGenerator.next()`, `device.id`,
     `device.timeZone`, `receivedAt: clock.now()`; count failures as `rejected` and log each
     failure at warn `'zkteco: marcación rechazada'` with `{ serialNumber, pin, deviceTime,
reason: error.message }`. `const { inserted } = await punchRepository.saveNew(valid)`; log
     info `'zkteco: marcaciones guardadas'` with `{ serialNumber, received, inserted,
duplicates: valid.length − inserted, rejected }`. Then `markSeen`/`save` as in the contact
     command. Return `ok({ accepted: records.length })` (unchanged meaning: the device must not
     resend lines we already processed or rejected). Update the class docblock.
   - Do, `attendance.queries.ts`: `AttendanceQueries { listDevices(page: PageQuery):
Promise<Page<DeviceDto>>; listPunches(filters: ListPunchesQuery): Promise<Page<PunchDto>> }`.
   - Do, `ListDevices`: `execute(page)` → `attendanceQueries.listDevices(page)`.
   - Do, `ListPunches`: input `ListPunchesQuery & { actor: Actor }`. If
     `companiesWith(actor, 'attendance.punches:read') !== 'ALL'` return
     `{ items: [], total: 0, page, pageSize }` with a comment (raw punches have no company until
     plan 002; README decision 5). Else `attendanceQueries.listPunches(filters)`.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes for these files.

6. **Persistence: schema, migration, adapters**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261001151824_create_attendance/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-punch.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (create)
   - Do, schema (follow the `db-change` recipe): add `"attendance"` to `datasource.schemas`; a
     `// ── Módulo: attendance ──` section with:
     - `model AttendanceDevice`: `id String @id @db.Uuid`,
       `serialNumber String @unique @map("serial_number") @db.VarChar(64)`,
       `name String @db.VarChar(100)`, `timeZone String @map("time_zone") @db.VarChar(64)`,
       `active Boolean @default(true)`, `registeredAt DateTime @map("registered_at") @db.Timestamptz(3)`,
       `lastSeenAt DateTime? @map("last_seen_at") @db.Timestamptz(3)`,
       `punches AttendancePunch[]`; `@@map("devices") @@schema("attendance")`.
     - `model AttendancePunch`: `id String @id @db.Uuid`,
       `deviceId String @map("device_id") @db.Uuid` with
       `device AttendanceDevice @relation(fields: [deviceId], references: [id])` (same module:
       FK allowed), `pin String @db.VarChar(32)`,
       `deviceLocalTime String @map("device_local_time") @db.Char(19)`,
       `occurredAt DateTime @map("occurred_at") @db.Timestamptz(3)`,
       `status String @db.VarChar(16)`, `verifyMode String @map("verify_mode") @db.VarChar(16)`,
       `receivedAt DateTime @map("received_at") @db.Timestamptz(3)`;
       `@@unique([deviceId, pin, deviceLocalTime])`, `@@index([deviceId, occurredAt])`,
       `@@index([occurredAt])`, `@@map("punches") @@schema("attendance")`.
     - `pnpm db:migrate --name create_attendance`; the SQL must contain no `DROP`. Replace the
       `YYYYMMDDHHMMSS` placeholder in this step's `Files:` line with the real folder name and
       note it in Deviations.
   - Do, `attendance.mapper.ts`: `DeviceMapper.toDomain/toPersistence` and
     `PunchMapper.toPersistence/toDto` (the only file mixing Prisma rows and domain; shape of
     `company.mapper.ts:116-153`). `PunchMapper.toDto` takes the row plus the device's
     `serialNumber`.
   - Do, `PrismaDeviceRepository`: `findById`, `findBySerialNumber` (`findUnique` by
     `serialNumber`), `save` via `upsert` mapping `isUniqueViolation` to
     `DeviceAlreadyRegisteredError` (shape of `prisma-company.repository.ts:118-149`).
   - Do, `PrismaPunchRepository.saveNew`: empty array → `{ inserted: 0 }` without a query; else
     `createMany({ data, skipDuplicates: true })` and return `{ inserted: result.count }`.
   - Do, `PrismaAttendanceQueries`:
     - `listDevices`: `findMany` ordered by `name asc`, paginated, plus `count`; `lastPunchAt` from
       `attendancePunch.groupBy({ by: ['deviceId'], where: { deviceId: { in: ids } },
_max: { occurredAt: true } })`; ISO strings for dates, `null` when absent.
     - `listPunches`: `where` from `deviceId`, `pin`, and `occurredAt: { gte: from, lte: to }`
       (only the bounds given); `include: { device: { select: { serialNumber: true } } }`;
       `orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }]`; paginated, plus `count`.
   - Do, `in-memory-attendance.store.ts` (shape of `in-memory-company.store.ts:14-71`):
     `InMemoryAttendanceStore { devices: Map<string, Device>; punches: Map<string, Punch> }`,
     `InMemoryDeviceRepository`, `InMemoryPunchRepository` (skips a punch whose
     `(deviceId, pin, deviceLocalTime)` already exists, counts the rest) and
     `InMemoryAttendanceQueries` with the same ordering and filters as the Prisma version.
   - Observable result: `pnpm db:migrate` applied; `\dt attendance.*` in `psql` lists `devices`
     and `punches`; `pnpm --filter @rrhh/api typecheck` passes.

7. **HTTP, module registration, config, existing tests**
   - Files: `apps/api/src/modules/attendance/http/attendance.router.ts` (create), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify), `apps/api/tests/test-app.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (modify)
   - Do, `attendance.router.ts` (shape of `organization.router.ts:86-106`):
     `bindRoute` for `listDevices` (`deps.listDevices.execute(query)`), `registerDevice`
     (`unwrap(await deps.registerDevice.execute(body))`), `listPunches`
     (`deps.listPunches.execute({ ...query, actor: requireActor(ctx) })`).
   - Do, `attendance.module.ts`: remove `allowedDeviceSerials` (cradle and registration) and its
     comment; register `deviceRepository: PrismaDeviceRepository`, `punchRepository:
PrismaPunchRepository`, `attendanceQueries: PrismaAttendanceQueries`, `registerDevice`,
     `listDevices`, `listPunches` (all `.singleton()`); add `router: createAttendanceRouter`;
     keep `deviceRouter`.
   - Do, `env.ts`: delete `ZKTECO_ALLOWED_SERIALS` and its comment (`env.ts:24-33`). The schema is
     `z.object` (`env.ts:9`), so a leftover value in someone's `.env` is ignored, not an error.
     `.env.example`: delete lines 17–19 (the ZKTeco block).
   - Do, `test-app.ts`: create one `InMemoryAttendanceStore` and register `deviceRepository`,
     `punchRepository`, `attendanceQueries` with its in-memory classes (next to the others at
     `test-app.ts:96-117`).
   - Do, the three existing test files: minimal edits so they compile and keep asserting what they
     assert today. Wherever they pass `allowedDeviceSerials: [...]`, instead build an in-memory
     store, register the listed serials as active devices (`Device.register` with `timeZone:
'America/Cancun'`, `FixedClock`/`SequentialIdGenerator` from `src/shared/testing/fakes.ts:11`, `:23`),
     and pass `deviceRepository`/`punchRepository`/`clock`/`idGenerator`. In `zkteco-adms.test.ts`
     replace the `allowedDeviceSerials` registration (`:26-33`) the same way and update the
     comment at `:20`. Do not add new test cases: the tester derives them.
   - Observable result: `pnpm check` passes; `tests/container.test.ts` resolves the new keys.

8. **Docs**
   - Files: `docs/integraciones/zkteco-senseface-2a.md` (modify), `docs/harness/modules.json` (modify)
   - Do: in the runbook, replace "Qué hace y qué no" bullets about the DB and the allowlist
     (`zkteco-senseface-2a.md:12-15`) and Configuración step 1 (`:25-26`) with: devices are
     registered via `POST /api/v1/attendance/devices` (HOLDING_ADMIN; body example with a
     fictitious serial and `America/Cancun`); ATTLOG is stored deduplicated with UTC and local
     time; other tables stay log-only; status via `GET /api/v1/attendance/devices`. Add the two
     new log messages to the "Qué buscar en el log" table. In `modules.json`, change the
     attendance summary's "Today: ZKTeco ADMS probe (log only)." to
     "Today: device registry and raw marcaciones from ZKTeco ADMS."
   - Observable result: `pnpm check` (harness/plans checks) passes.

9. **Test files and review repair of this plan** (declared for `pnpm plans:scope` after review
   L1/L2; added by the main session, see Deviation 6)
   - Files: `packages/domain/src/time-zone.test.ts` (create), `apps/api/src/modules/attendance/domain/device.test.ts` (create), `apps/api/src/modules/attendance/domain/punch.test.ts` (create), `apps/api/src/modules/attendance/application/commands/register-device.command.test.ts` (create), `apps/api/src/modules/attendance/application/queries/list-punches.query.test.ts` (create), `packages/contracts/src/attendance/device.contract.test.ts` (create), `packages/contracts/src/attendance/punch.contract.test.ts` (create), `packages/contracts/src/identity/access.contract.test.ts` (modify), `apps/api/tests/attendance.test.ts` (create), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (create), `apps/api/src/config/env.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `docs/architecture.md` (modify)
   - Do: nothing for the implementer (tests by the tester; the three count-only edits are
     Deviation 2; `docs/architecture.md` legend is review L1).
   - Observable result: `pnpm plans:scope` passes.

## Acceptance criteria

- [ ] `POST /api/v1/attendance/devices` as HOLDING_ADMIN with `{ serialNumber, name, timeZone:
'America/Cancun' }` → 201 `{ id }`; same serial again → 409 `DEVICE_ALREADY_REGISTERED`;
      `timeZone: 'Mars/Olympus'` → 400; as HR → 403.
- [ ] `GET /iclock/cdata?SN=<registered>` answers the options block as today;
      `SN=<unregistered>` → the same rejection as today and the warn log
      `zkteco: dispositivo no autorizado`.
- [ ] `POST /iclock/cdata?SN=<registered>&table=ATTLOG` with two ATTLOG lines → `OK: 2`; the same
      body again → `OK: 2` and `attendance.punches` still has 2 rows; the log shows
      `zkteco: marcaciones guardadas` with `inserted: 2` then `inserted: 0, duplicates: 2`.
- [ ] A stored punch with `deviceTime 2026-09-28 12:17:29` on an `America/Cancun` device has
      `occurred_at = 2026-09-28 17:17:29+00` and `device_local_time = '2026-09-28 12:17:29'`.
- [ ] An ATTLOG line with an impossible date (`2026-02-30 08:00:00`) is not stored, is logged as
      `zkteco: marcación rechazada`, and still counts in `OK: <n>`.
- [ ] `GET /api/v1/attendance/devices` (HOLDING_ADMIN or HR) lists the device with a non-null
      `lastSeenAt` after a contact and `lastPunchAt` after an ATTLOG push; anonymous → 401.
- [ ] `GET /api/v1/attendance/punches` as HOLDING_ADMIN lists punches newest first, filterable by
      `deviceId`, `pin`, `from`, `to`; as HR → 403.
- [ ] Pushes of `OPLOG`/`USER`/`BIODATA` are logged as today and write no rows.
- [ ] The real SenseFace 2A, once registered, is shown with a recent `lastSeenAt` and a real
      marcación appears in `/attendance/punches` (verifier with the user and the device; NOT
      VERIFIED if unavailable).
- [ ] `/api/v1/docs` (Scalar) shows the three new endpoints.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                                                                        |
| ----------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `localDateTimeToUtc`/`isValidTimeZone`; `Device.register` validations; `markSeen` resolution; `Punch.fromDevice` validations                                                                                                 |
| application | yes     | `RegisterDevice` happy path + duplicate; contact/push with unregistered, inactive and registered devices; ATTLOG dedupe, rejected lines, non-ATTLOG tables write nothing; `ListPunches` non-holding actor gets an empty page |
| contract    | yes     | `RegisterDeviceSchema` (serial, name, zone), `ListPunchesQuerySchema`; permissions of the new routes in `access.contract.test.ts`                                                                                            |
| http        | yes     | the three `/api/v1/attendance/*` routes (201/409/400/401/403, pagination, filters); `/iclock` against registered devices                                                                                                     |
| integration | yes     | `PrismaDeviceRepository` (unique serial), `PrismaPunchRepository.saveNew` skipDuplicates, `PrismaAttendanceQueries` (`lastPunchAt`, filters, order)                                                                          |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                                                                  |

## Deviations

Implemented 2026-10-01. All steps 1-8 done. Cosmetic deviations (fixed forward, no design impact):

1. **Migration folder name** (Step 6): the placeholder `YYYYMMDDHHMMSS_create_attendance` is
   `apps/api/prisma/migrations/20261001151824_create_attendance/`. SQL has no `DROP`.
2. **Existing tests outside the plan's file list, minimal count/reference updates to keep the
   suite green** (consequences of the planned changes, no new cases):
   - `packages/contracts/src/openapi.test.ts`: operation count `19` to `22` (three new routes).
   - `apps/api/src/modules/identity/application/session-authenticator.test.ts`: HR grant count
     `5` to `6` (two assertions), because HR now holds `attendance.devices:read`.
   - `apps/api/src/modules/identity/domain/role-catalog.test.ts`: besides the two edits the plan
     lists, the "varias asignaciones se acumulan" count `10` to `12` (same reason).
   - `apps/api/src/config/env.test.ts`: removed the `loadEnv — ZKTECO_ALLOWED_SERIALS` describe
     (tested the variable Step 7 deletes).
3. **Push test assertions loosened** (`record-device-push.command.test.ts`): two probe tests
   asserted the exact full log (`toEqual([...])` / `toHaveLength(1)`); an ATTLOG push now also
   logs `zkteco: marcaciones guardadas`, so they now assert the first two entries / the absence of
   debug entries. Same intent. Also renamed test titles that said "lista permitida" to "registrado".
4. **`pnpm plans:scope` reports 27 files as "Fuera de alcance"**, but all of them are in the
   plan's Steps 3-7 `Files:` lists (the tool seems to read only the first line of each multi-line
   `Files:` list). The only truly unlisted files are the four in item 2.
   _Main session (2026-10-01):_ confirmed. The tool reads one line per `Files:` entry; the plan's
   lists were wrapped. Joined each list into one line (same paths) and replaced the migration
   placeholder with the real folder. `plans:scope` now flags only `env.test.ts`,
   `session-authenticator.test.ts` and `openapi.test.ts`, all covered by item 2.
5. **Stale doc left untouched**: `docs/adr/0008-endpoints-de-dispositivos-fuera-de-contratos.md:24`
   still says the device allowlist is `ZKTECO_ALLOWED_SERIALS` (out of the plan's scope). See
   finding `plans/hallazgos/` (filed).
6. **Step 9 added after review** (main session): declares the test files and
   `docs/architecture.md` so `plans:scope` can check them (review L2), and records the L1/L3
   repairs. No plan behavior changed.

Commands: `pnpm check` green; `pnpm test:integration` green (115 tests, existing suites; the
attendance Prisma adapters have no integration tests yet, that is the tester's job);
`pnpm db:migrate --name create_attendance` applied on the dev DB.

## Test coverage

Tester, 2026-10-01. Baseline: `pnpm check` verde (516 tests api, 3 skipped existentes) y
`pnpm test:integration` verde (115). Ningún GAP ni NOT CONFIRMED: todo lo que el plan promete y es
ejercitable en local está implementado y se confirmó por ejecución. Lo que requiere el equipo real
(criterio del SenseFace 2A) queda para el verifier.

| Comportamiento (plan / código)                                                      | Fuente                                 | Capa        | Test                                                                                     | Estado                                              |
| ----------------------------------------------------------------------------------- | -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `localDateTimeToUtc` Cancún → UTC (caso observado del equipo real)                  | `time-zone.ts:44-72`                   | domain      | `packages/domain/src/time-zone.test.ts › convierte la marcación observada…`              | CONFIRMED                                           |
| Horario de verano, cruce de día, bisiesto, hora inexistente y ambigua               | `time-zone.ts:20-72`                   | domain      | `time-zone.test.ts › respeta el horario de verano…`, `es determinista en…`               | CONFIRMED                                           |
| Fechas imposibles, formatos y zona inválida                                         | `time-zone.ts:46-65`                   | domain      | `time-zone.test.ts › rechaza la fecha imposible…`, `rechaza el formato…`, `…zona…`       | CONFIRMED                                           |
| `isValidTimeZone`                                                                   | `time-zone.ts:5-12`                    | domain      | `time-zone.test.ts › isValidTimeZone`                                                    | CONFIRMED                                           |
| `Device.register`: validaciones, trim, activo, evento                               | `device.ts:48-79`                      | domain      | `domain/device.test.ts › Device.register`                                                | CONFIRMED                                           |
| `Device.markSeen` y resolución de 60 s (límite exacto)                              | `device.ts:107-114`                    | domain      | `device.test.ts › Device.markSeen`                                                       | CONFIRMED                                           |
| `Punch.fromDevice`: PIN, longitudes, UTC, errores propagados                        | `punch.ts:38-75`                       | domain      | `domain/punch.test.ts`                                                                   | CONFIRMED                                           |
| `RegisterDevice`: alta, duplicado (serial recortado), dominio inválido              | `register-device.command.ts:27-48`     | application | `register-device.command.test.ts`                                                        | CONFIRMED                                           |
| Contact: equipo inactivo / no registrado, `markSeen` + persistencia por resolución  | `record-device-contact.command.ts`     | application | `record-device-contact.command.test.ts` (3 nuevos)                                       | CONFIRMED                                           |
| Push: guarda ATTLOG, dedupe, rechazadas cuentan en `accepted`, logs, zona, inactivo | `record-device-push.command.ts:55-100` | application | `record-device-push.command.test.ts › persistencia de marcaciones (plan 001)`            | CONFIRMED                                           |
| Push de OPERLOG/OPLOG/USER/BIODATA/options no escribe filas                         | `record-device-push.command.ts:55`     | application | `record-device-push.command.test.ts › un push de la tabla %s no escribe…`                | CONFIRMED                                           |
| `ListPunches`: actor sin permiso holding-wide recibe página vacía; filtros          | `list-punches.query.ts:15-27`          | application | `list-punches.query.test.ts`                                                             | CONFIRMED                                           |
| `ListDevices` ordena y calcula `lastPunchAt` (en memoria)                           | `in-memory-attendance.store.ts`        | application | `list-punches.query.test.ts › ListDevices`                                               | CONFIRMED                                           |
| `RegisterDeviceSchema` (serial, nombre, zona)                                       | `device.contract.ts:23-33`             | contract    | `packages/contracts/src/attendance/device.contract.test.ts`                              | CONFIRMED                                           |
| `ListPunchesQuerySchema` (defaults, filtros, ISO, uuid)                             | `punch.contract.ts:25-30`              | contract    | `punch.contract.test.ts`                                                                 | CONFIRMED                                           |
| Permisos de las 3 rutas, sin `companyParam`                                         | contratos                              | contract    | `access.contract.test.ts › las rutas de negocio declaran…`, `device/punch.contract.test` | CONFIRMED                                           |
| `POST /attendance/devices`: 201, 409, 400 (zona, serial, nombre), 403 HR, 401       | `attendance.router.ts`                 | http        | `tests/attendance.test.ts › POST /attendance/devices`                                    | CONFIRMED                                           |
| `GET /attendance/devices`: ADMIN y HR, `lastSeenAt`/`lastPunchAt`, paginación       | `attendance.router.ts`                 | http        | `attendance.test.ts › GET /attendance/devices`                                           | CONFIRMED                                           |
| `/iclock` contra el registro: registrado OK, no registrado 403, dedupe, `OK: n`     | `zkteco-adms.router.ts`                | http        | `attendance.test.ts › /iclock contra el registro de equipos`                             | CONFIRMED                                           |
| `GET /attendance/punches`: orden, filtros, paginación, 400, 403 HR, 401             | `attendance.router.ts`                 | http        | `attendance.test.ts › GET /attendance/punches`                                           | CONFIRMED                                           |
| Serial único, upsert de `lastSeenAt`                                                | `prisma-device.repository.ts`          | integration | `tests/integration/attendance/prisma-attendance.int.test.ts › PrismaDeviceRepository`    | CONFIRMED                                           |
| `saveNew` con `skipDuplicates`, `inserted` real, hora local y UTC                   | `prisma-punch.repository.ts:11-20`     | integration | `prisma-attendance.int.test.ts › PrismaPunchRepository.saveNew`                          | CONFIRMED                                           |
| `lastPunchAt`, filtros, rango inclusivo, orden y desempate, paginación (Prisma)     | `prisma-attendance.queries.ts`         | integration | `prisma-attendance.int.test.ts › PrismaAttendanceQueries`                                | CONFIRMED                                           |
| Marcación real del SenseFace 2A visible tras registrar el equipo                    | criterio de aceptación                 | —           | —                                                                                        | NOT CONFIRMED (requiere el equipo físico; verifier) |

## Review findings

Reviewer, 2026-10-01. Diff `main...HEAD` (07fd79a, 24e4730, 686353c), working tree clean.

**Checklist: 11/13** (2 failed, both bookkeeping/docs; no product-code failure).

- [ ] `pnpm plans:scope`: **FAILS** (exit 1), 13 files flagged. 3 are the documented Deviation 2
      (`env.test.ts`, `session-authenticator.test.ts`, `openapi.test.ts`). The other 10 are the
      tester's new/modified test files (`time-zone.test.ts`, `device.test.ts`, `punch.test.ts`,
      `register-device.command.test.ts`, `list-punches.query.test.ts`, `device.contract.test.ts`,
      `punch.contract.test.ts`, `access.contract.test.ts`, `tests/attendance.test.ts`,
      `tests/integration/attendance/prisma-attendance.int.test.ts`): the plan has no "Test files"
      step declaring them (plans `identity-acceso/005` and `006` do). All 13 reviewed by hand: they
      are legit tests for this plan. Hot files are add-only (`contracts/src/index.ts`,
      `test-app.ts`, `modules.json` summary line as planned); `schema.prisma` also edits the
      `schemas` line, as the `db-change` recipe requires.
- [x] `pnpm check` green (turbo 19/19 tasks, arch, plans, harness, quality).
- [x] `pnpm test:integration` green (12 files, 130 tests, includes the new attendance suite).
- [x] Business rules in `domain/` (`Device.register`/`markSeen`, `Punch.fromDevice`,
      `localDateTimeToUtc`); router and mappers have none.
- [x] CQRS-lite: `RegisterDevice` → aggregate → repository → `Result`; reads via
      `AttendanceQueries` returning contract DTOs; repositories have no screen methods.
- [x] Types from `@rrhh/contracts`; nothing duplicated.
- [x] Expected errors are `Result` + `DEVICE_ALREADY_REGISTERED` / `DEVICE_NOT_ALLOWED`.
- [x] Dates UTC (`timestamptz`), time and ids via `Clock`/`IdGenerator`. No money involved.
- [x] New migration `20261001151824_create_attendance`: creates schema, two tables, indexes, a
      same-module FK. No `DROP`, no cross-module FK.
- [x] DI resolves (`container.test.ts` green); `attendanceModule` registered once.
- [x] No secrets, `.env` contents or real personal data (fictitious `TESTSN001`, PINs).
- [x] Deviations honest: spot-checked item 2 (`role-catalog.test.ts` 10 → 12,
      `session-authenticator.test.ts` 5 → 6 twice, `openapi.test.ts` 19 → 22, the env describe
      removed) against the diff; matches.
- [ ] Docs: **stale** `docs/architecture.md:25` (see L1). Runbook and `modules.json` updated;
      ADR 0008 already filed as a hallazgo.

### Findings

**Critical / High / Medium:** none.

**L1 (Low, docs, needs a change): `docs/architecture.md:25` still marks attendance as "† = solo
sonda ZKTeco (log)".** After this plan the module persists devices and ATTLOG punches, so the
diagram legend is wrong. Scenario: a reader of the architecture doc assumes attendance writes
nothing to Postgres and that there is no `attendance` schema. The file is not in the plan's
`Files:` lists; resolution needs a main-session call: add it to Step 8 as a deviation and fix the
legend, or file it as a hallazgo next to the ADR 0008 one.

**L2 (Low, plan bookkeeping, no code change): `pnpm plans:scope` fails on the 10 undeclared test
files** listed in the checklist. Scenario: the scope gate stays red for this plan and later
phases. Resolution: main session adds a "Test files of this plan" step (same shape as
`identity-acceso/006` step 3) or a Deviations note listing them. No test needs changes.

**L3 (Low, non-blocking, no change required by this plan): `listDevices` orders only by `name`**
(`apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts:16`;
in-memory `in-memory-attendance.store.ts:68` uses `localeCompare`). Scenario: two checadores
with the same name ("Entrada") on a page boundary can repeat or vanish between pages, because
Postgres gives no stable order for ties; Postgres collation and `localeCompare` can also order
mixed-case names differently, so the http and integration tests could disagree. Follows the
plan as written (`name asc`). Low impact with a handful of devices; an `id` tiebreak would fix
it. Recorded for awareness; the main session decides whether it goes into this repair or a
follow-up.

Bug hunt otherwise clean: traced contract → `RegisterDevice` → `Device.register` → upsert (unique
race mapped to 409); `/iclock` contact/push → registry lookup (unregistered and inactive both
403 + warn) → `Punch.fromDevice` (UTC via two-pass offset; impossible dates rejected, still
counted in `OK: n`) → `createMany skipDuplicates` (unique index `(device_id, pin,
device_local_time)` makes the resend from `Stamp=None` idempotent, including duplicates inside one
batch, since `ON CONFLICT DO NOTHING` skips them) → `markSeen` throttled write. Large batches:
Prisma 7 runtime chunks by bind-value limit (`maxBindValues` present in
`@prisma/client/runtime`), so a big history push does not exceed Postgres' 65535 params.
Tenancy: `listPunches` needs a holding-wide grant (route 403 for HR; company-scoped grants get an
empty page); `listDevices` visible to HR of any company, as README decision 5 intends.

Status stays `review` because L1 and L2 need edits (doc + plan); neither touches product code, so
after they are resolved the main session can move the plan to `verify` without a new testing pass.

### Resolution (main session, 2026-10-01)

- **L1 fixed**: `docs/architecture.md:25` legend now reads "† = solo marcaciones crudas ZKTeco".
- **L2 fixed**: Step 9 declares the tester's files, the three Deviation 2 tests and
  `docs/architecture.md`; `pnpm plans:scope` passes.
- **L3 fixed**: `listDevices` orders by `name`, then `id`, in
  `prisma-attendance.queries.ts` and `in-memory-attendance.store.ts` (comment explains why).
  Product change of one line per adapter; existing http and integration suites rerun green.

Plan to `verify`.

## Verification
