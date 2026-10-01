---
status: approved
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
   - Files: `packages/domain/src/identity/access.ts` (modify),
     `apps/api/src/modules/identity/domain/role-catalog.ts` (modify),
     `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify)
   - Do: append to `PERMISSIONS` (after `employees:register`): `'attendance.devices:read'`,
     `'attendance.devices:manage'`, `'attendance.punches:read'`. Add only
     `'attendance.devices:read'` to HR's list, with a comment citing README decision 5 of
     `attendance-marcaciones` (raw punches have no company until plan 002). HOLDING_ADMIN gets the
     three automatically (`role-catalog.ts:15`). In the test: add `'attendance.devices:read'` to
     the expected HR list (`role-catalog.test.ts:22-30`) and change `toHaveLength(5)` to
     `toHaveLength(6)` (`:63`). No other test change.
   - Observable result: `pnpm --filter @rrhh/api test role-catalog` passes.

3. **Contracts**
   - Files: `packages/contracts/src/attendance/device.contract.ts` (create),
     `packages/contracts/src/attendance/punch.contract.ts` (create),
     `packages/contracts/src/index.ts` (modify), `packages/contracts/openapi.json` (modify)
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
   - Files: `apps/api/src/modules/attendance/domain/device.ts` (create),
     `apps/api/src/modules/attendance/domain/device.repository.ts` (create),
     `apps/api/src/modules/attendance/domain/punch.ts` (create),
     `apps/api/src/modules/attendance/domain/punch.repository.ts` (create),
     `apps/api/src/modules/attendance/domain/errors.ts` (modify)
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
   - Files: `apps/api/src/modules/attendance/application/commands/register-device.command.ts` (create),
     `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify),
     `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify),
     `apps/api/src/modules/attendance/application/queries/attendance.queries.ts` (create),
     `apps/api/src/modules/attendance/application/queries/list-devices.query.ts` (create),
     `apps/api/src/modules/attendance/application/queries/list-punches.query.ts` (create)
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
   - Files: `apps/api/prisma/schema.prisma` (modify),
     `apps/api/prisma/migrations/YYYYMMDDHHMMSS_create_attendance/migration.sql` (create),
     `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (create),
     `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (create),
     `apps/api/src/modules/attendance/infrastructure/prisma-punch.repository.ts` (create),
     `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (create),
     `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (create)
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
   - Files: `apps/api/src/modules/attendance/http/attendance.router.ts` (create),
     `apps/api/src/modules/attendance/attendance.module.ts` (modify),
     `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify),
     `apps/api/tests/test-app.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify),
     `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify),
     `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (modify)
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

## Test coverage

## Review findings

## Verification
