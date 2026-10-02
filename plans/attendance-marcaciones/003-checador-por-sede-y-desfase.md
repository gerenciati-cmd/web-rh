---
status: review
module: attendance
min_implementer: mid
depends_on: [organization-sedes/001]
---

# 003 — Checador per sede and clock-offset detection

## Context

**What exists today** (plans 001–002, done):

- `Device` has `serialNumber`, `name`, free-text `timeZone` (any IANA zone), `active`,
  `registeredAt`, `lastSeenAt`; no site (`apps/api/src/modules/attendance/domain/device.ts:14-21`).
  `Device.register` validates the zone with `isValidTimeZone` only (`device.ts:47-77`).
- `RegisterDevice` takes `{ serialNumber, name, timeZone }`
  (`application/commands/register-device.command.ts:10-48`); contract `RegisterDeviceSchema`
  validates the zone with `isValidTimeZone` (`packages/contracts/src/attendance/device.contract.ts:23-34`);
  `DeviceSchema` (`device.contract.ts:8-20`); routes (`device.contract.ts:37-55`); router
  (`http/attendance.router.ts:19-25`).
- `RecordDevicePush` converts each ATTLOG line with `device.timeZone` and stamps one `receivedAt`
  per push (`application/commands/record-device-push.command.ts:109-148`); it then saves
  `lastSeenAt` (`:150`). Nothing compares the punch instant with the reception time (plan 001 put
  clock-skew detection out of scope).
- Read side: `PrismaAttendanceQueries.listDevices` (`infrastructure/prisma-attendance.queries.ts:12-44`),
  in-memory `toDeviceDto` (`infrastructure/in-memory/in-memory-attendance.store.ts:104-…`), mapper
  `DeviceMapper` (`infrastructure/attendance.mapper.ts:14-…`).
- Cross-module port pattern inside attendance: `PunchOwnerDirectory` + `EmployeesPunchOwnerDirectory`
  (plan 002). The same pattern over `OrganizationApi` exists in employees
  (`apps/api/src/modules/employees/infrastructure/organization-employer-directory.ts:19-35`).
- Module wiring: `apps/api/src/modules/attendance/attendance.module.ts:21-50`.
- Tests that register devices (break when the input changes): listed in Step 6.

**What `organization-sedes/001` promises:** `OrganizationApi.findSite(siteId)` →
`SiteSummary { id; name; country; timeZone; active } | null`; time zones of a site come from the
closed per-country list (`SITE_TIME_ZONES`); in-memory site store and `createSite` in the test
container.

**What we need** (`organization-sedes` README decisions 1, 8, 9): each checador belongs to a sede
and takes its time zone from it (closed list, no free text), and the API detects when a device's
clock (or its zone) is off by more than 5 minutes.

**Approach.**

- The device stores `siteId` and keeps its own `timeZone` column, but the zone is **copied from
  the sede** on registration and on site change; the API no longer accepts a free-text zone.
  Alternative considered: reading the zone from organization on every push — rejected, every ATTLOG
  push would cross modules for a value that rarely changes.
- Clock offset is measured only on **real-time pushes**: a push that carries exactly one ATTLOG
  line (with `Realtime=1` the device sends each marcación as it happens, plan 001 observed single
  lines). `offset = receivedAt − occurredAt` in seconds; it is stored on the device with its
  measurement time and flagged when `|offset| > 300`. History resends (many lines, from
  `Stamp=None`) are not measured: their old punches would look like a huge offset. Limitation,
  stated in the docblock: a punch delayed by a network outage and sent alone also looks late.

## Out of scope

- Sending users to the device, the command queue, sync (plans 004–005).
- Correcting stored punches when a wrong zone is detected; changing the device clock remotely.
- Deactivating devices. Changing the 5-minute threshold through configuration (constant only).
- Web/mobile screens.

## Dependencies

- `organization-sedes/001` — `OrganizationApi.findSite`, `SiteSummary`, the closed zone list,
  `createSite` and the in-memory site store in `apps/api/tests/test-app.ts`.

## Steps

1. **Contract**
   - Files: `packages/contracts/src/attendance/device.contract.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do: `DeviceSchema` adds `siteId: z.uuid().nullable()`, `clockOffsetSeconds:
z.number().int().nullable()` (`.describe('Hora recibida − hora de la marcación, medida en el último envío en tiempo real')`),
     `clockOffsetMeasuredAt: z.iso.datetime().nullable()`, `clockSuspect: z.boolean()`.
     `RegisterDeviceSchema` becomes `{ serialNumber, name, siteId: z.uuid() }` (remove `timeZone`
     and the `isValidTimeZone` import if unused). New
     `AssignDeviceSiteSchema = z.object({ siteId: z.uuid() }).meta({ id: 'AssignAttendanceDeviceSiteInput' })`
     and route `assignDeviceSite`: `PUT /attendance/devices/:deviceId/site`, summary
     `'Asigna la sede de un checador (y su zona horaria)'`, `requires('attendance.devices:manage')`,
     `params: z.object({ deviceId: z.uuid() })`, `response: z.undefined()`, `successStatus: 204`.
     Regenerate the snapshot; operation count +1.
   - Observable result: contracts typecheck passes.

2. **Domain**
   - Files: `apps/api/src/modules/attendance/domain/device.ts` (modify), `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do: props add `siteId: string | null`, `clockOffsetSeconds: number | null`,
     `clockOffsetMeasuredAt: Date | null`. `register` input replaces nothing in validation but
     takes `siteId: string` and the `timeZone` **of the site** (caller passes it).
     `export const CLOCK_OFFSET_TOLERANCE_SECONDS = 300` (docblock: README decision 9 of
     `organization-sedes`). Methods: `assignSite(siteId, timeZone): void`;
     `recordClockOffset(seconds: number, now: Date): void`; getter
     `clockSuspect: boolean` = offset not null and `Math.abs(offset) > CLOCK_OFFSET_TOLERANCE_SECONDS`.
     Errors: `SiteNotFoundError extends NotFoundError` (`'SITE_NOT_FOUND'`), `InactiveSiteError
extends BusinessRuleViolationError` (`'SITE_INACTIVE'`), `DeviceNotFoundError extends
NotFoundError` (`'DEVICE_NOT_FOUND'`, `'El checador no existe'`).
   - Observable result: typecheck lists only the call sites Steps 3–6 fix.

3. **Port, adapter and application**
   - Files: `apps/api/src/modules/attendance/application/ports/site-directory.ts` (create), `apps/api/src/modules/attendance/infrastructure/organization-site-directory.ts` (create), `apps/api/src/modules/attendance/application/commands/register-device.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.ts` (create), `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify)
   - Do: port `DeviceSite { id; timeZone; active }`, `SiteDirectory.find(siteId)`; adapter
     `OrganizationSiteDirectory` over `organizationApi.findSite`.
   - Do, `RegisterDevice`: input `{ serialNumber, name, siteId }`; new dep `siteDirectory`;
     missing site → `SiteNotFoundError`, inactive → `InactiveSiteError`; pass `siteId` and the
     site's `timeZone` to `Device.register`.
   - Do, `AssignDeviceSite`: deps `deviceRepository, siteDirectory`; `findById` or
     `DeviceNotFoundError`; same site checks; `assignSite`; save; `ok(undefined)`.
   - Do, `RecordDevicePush`: inside the ATTLOG branch, when `valid.length === 1` (one real-time
     line), `seconds = Math.round((receivedAt − valid[0].occurredAt) / 1000)`;
     `device.recordClockOffset(seconds, receivedAt)`; if `device.clockSuspect`, log warn
     `'zkteco: desfase de reloj'` with `{ serialNumber, offsetSeconds: seconds }`. Make the final
     save run when either `markSeen` returned true or an offset was recorded. Docblock with the
     limitation from Context.
   - Observable result: typecheck passes.

4. **Persistence and read side**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261002220840_add_device_site_and_offset/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify)
   - Do: `AttendanceDevice` adds `siteId String? @map("site_id") @db.Uuid` (`/// referencia por id
a organization.sites, sin FK (ADR 0010)`), `clockOffsetSeconds Int? @map("clock_offset_seconds")`,
     `clockOffsetMeasuredAt DateTime? @map("clock_offset_measured_at") @db.Timestamptz(3)`.
     Migration as in `employees-rfc/001` Deviation 1 if needed; only `ADD COLUMN`; replace the
     placeholder with the real folder; note in Deviations. Mapper reads/writes the three fields.
     Both `listDevices` return `siteId`, `clockOffsetSeconds`, `clockOffsetMeasuredAt` (ISO or
     null) and `clockSuspect` (same rule as the domain getter; import the constant from the
     domain file).
   - Observable result: migration applied; typecheck passes.

5. **HTTP and module**
   - Files: `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify)
   - Do: `bindRoute` for `assignDeviceSite` (`unwrap(await deps.assignDeviceSite.execute({ deviceId:
params.deviceId, siteId: body.siteId }))`). Register `siteDirectory:
asClass(OrganizationSiteDirectory)` and `assignDeviceSite` in cradle and registrations.
   - Observable result: `tests/container.test.ts` resolves the new keys.

6. **Existing tests and docs**
   - Files: `apps/api/src/modules/attendance/domain/device.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/register-device.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (modify), `apps/api/src/modules/attendance/application/queries/list-punches.query.test.ts` (modify), `packages/contracts/src/attendance/device.contract.test.ts` (modify), `apps/api/tests/attendance.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (modify), `docs/integraciones/zkteco-senseface-2a.md` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.test.ts` (create), `apps/api/tests/attendance-clock-offset.test.ts` (create)
   - Do: tests that register devices pass `siteId` (HTTP: create a site first through
     `POST /api/v1/sites` or the container's `createSite`; unit: stub `SiteDirectory` returning
     `America/Cancun`); `Device.register` callers pass `siteId` and `timeZone`. Assertions that
     checked the old free-text zone input (`'Mars/Olympus'` → 400) become the site checks only if
     they no longer compile or apply; add no new cases. Runbook: registration now takes `siteId`
     (create the sede first with `POST /api/v1/sites`), `PUT …/devices/:id/site` for devices
     registered before, and a "Desfase de reloj" note (what `clockSuspect` means, the 5-minute
     tolerance, the warn log, and that only single-line pushes are measured).
   - Observable result: `pnpm check` and `pnpm test:integration` pass.

## Acceptance criteria

- [ ] `POST /api/v1/attendance/devices` `{ serialNumber, name, siteId }` with an active
      `America/Cancun` site → 201, and `GET …/devices` shows `siteId` and `timeZone:
'America/Cancun'`; unknown site → 404 `SITE_NOT_FOUND`; a body with `timeZone` and no
      `siteId` → 400.
- [ ] `PUT …/devices/:id/site` on a device registered before (null site) → 204; `siteId` and the
      site's zone appear in the list; unknown device → 404 `DEVICE_NOT_FOUND`; HR → 403.
- [ ] A single-line ATTLOG push stamped with the current local time of the site → `clockOffsetSeconds`
      within ±5 s and `clockSuspect: false`.
- [ ] A single-line push stamped 1 hour ahead → `clockOffsetSeconds ≈ −3600`, `clockSuspect: true`,
      warn log `zkteco: desfase de reloj`.
- [ ] A multi-line push (history) leaves `clockOffsetSeconds` unchanged.
- [ ] Real device: after assigning its sede, a real marcación shows a small offset
      (user with the SenseFace 2A; NOT VERIFIED if unavailable).

## Test layers required

| Layer       | Applies | Focus                                                                                    |
| ----------- | ------- | ---------------------------------------------------------------------------------------- |
| domain      | yes     | `assignSite`, `recordClockOffset`, `clockSuspect` boundary (300 / 301 s, negative)       |
| application | yes     | `RegisterDevice` / `AssignDeviceSite` site errors; push measures only single-line ATTLOG |
| contract    | yes     | new `RegisterDeviceSchema`, `AssignDeviceSiteSchema`, `DeviceSchema` fields, access      |
| http        | yes     | acceptance criteria 1–5                                                                  |
| integration | yes     | new columns persisted; `listDevices` returns them                                        |
| e2e         | no      | (no e2e infrastructure yet)                                                              |

## Deviations

1. **Cradle key renamed** (design-neutral, cosmetic). The plan says to register `siteDirectory`
   in attendance, but employees already registers `siteDirectory` (its own `WorkSite` adapter);
   awilix keys are global, so attendance's adapter silently replaced it and
   `authorization.test.ts` failed with `SITE_COUNTRY_MISMATCH`. The attendance one is registered
   as `deviceSiteDirectory` (deps of `RegisterDevice` / `AssignDeviceSite` renamed too). The port
   type keeps the name `SiteDirectory` (module-local).
2. **Migration** created with `pnpm db:migrate --name add_device_site_and_offset`
   (`20261002220840_add_device_site_and_offset`); only `ADD COLUMN` x3, no placeholder folder.
3. **`RecordDevicePush`**: the offset measurement was extracted to a private method
   `measureClockOffset` to keep `execute` under the lint complexity limit (same behavior).
4. **Temp file**: `apps/api/tests/zz-scratch.test.ts` was created by me while debugging and the
   `guard-bash` hook forbids deleting it; it is now a skipped empty suite. The main session must
   delete it.

## Test coverage

Baseline (before writing tests): `pnpm check` green (api 727 passed / 5 skipped), `pnpm test:integration` green (168). No pre-existing failures.

| Behavior (from plan / code)                                                                                      | Source                                  | Layer       | Test                                                                           | State         |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------- | ------------------------------------------------------------------------------ | ------------- |
| `Device.register` keeps siteId, starts with no offset                                                            | `device.ts:78-88`                       | domain      | `device.test.ts › Device.register (sede y desfase)`                            | CONFIRMED     |
| `assignSite` sets siteId and copies the zone (also from a null-site device)                                      | `device.ts:143`                         | domain      | `device.test.ts › Device.assignSite`                                           | CONFIRMED     |
| `recordClockOffset` stores seconds + measuredAt, replaces previous                                               | `device.ts:148`                         | domain      | `device.test.ts › Device.recordClockOffset y clockSuspect`                     | CONFIRMED     |
| `clockSuspect` boundary: 300 not suspect, 301 / -301 / -3600 suspect                                             | `device.ts:32,135`                      | domain      | `device.test.ts › desfase de %i s` (it.each)                                   | CONFIRMED     |
| `RegisterDevice`: unknown site → `SITE_NOT_FOUND`, inactive → `SITE_INACTIVE`                                    | `register-device.command.ts:41-42`      | application | `register-device.command.test.ts`                                              | CONFIRMED     |
| `RegisterDevice` stores siteId and the site's zone                                                               | `register-device.command.ts:44-51`      | application | `register-device.command.test.ts › registra el equipo…`                        | CONFIRMED     |
| `AssignDeviceSite`: happy path, `DEVICE_NOT_FOUND`, `SITE_NOT_FOUND`, `SITE_INACTIVE`, device untouched on error | `assign-device-site.command.ts:22-35`   | application | `assign-device-site.command.test.ts` (4 tests)                                 | CONFIRMED     |
| Push measures only a single-valid-line ATTLOG (0 s, -3600 s, +600 s, 300 edge)                                   | `record-device-push.command.ts:131-143` | application | `record-device-push.command.test.ts › desfase de reloj`                        | CONFIRMED     |
| Multi-line push does not measure / keeps previous offset; non-ATTLOG ignored                                     | `record-device-push.command.ts:98,134`  | application | same describe                                                                  | CONFIRMED     |
| Warn `zkteco: desfase de reloj` only when suspect                                                                | `record-device-push.command.ts:138-142` | application | same describe                                                                  | CONFIRMED     |
| Offset persisted even when `markSeen` returns false                                                              | `record-device-push.command.ts:108`     | application | `… › una medición nueva dentro del minuto se persiste…`                        | CONFIRMED     |
| `RegisterDeviceSchema` requires siteId, rejects timeZone-only body                                               | `device.contract.ts:23-34`              | contract    | `device.contract.test.ts › RegisterDeviceSchema`                               | CONFIRMED     |
| `AssignDeviceSiteSchema`, `DeviceSchema` new fields, route `assignDeviceSite`                                    | `device.contract.ts:8-20,36-40,57-65`   | contract    | `device.contract.test.ts` (3 new describes/its)                                | CONFIRMED     |
| POST devices with site → list shows siteId/zone; unknown site 404; no siteId 400                                 | acceptance 1                            | http        | `attendance.test.ts › POST / GET /attendance/devices`                          | CONFIRMED     |
| PUT site: 204 + list shows siteId/zone; device 404; site 404; 400; HR 403; 401                                   | acceptance 2                            | http        | `attendance.test.ts › PUT /attendance/devices/:deviceId/site`                  | CONFIRMED     |
| Single-line push in sync → offset ≈ 0, not suspect                                                               | acceptance 3                            | http        | `attendance-clock-offset.test.ts` (fixed clock injected into RecordDevicePush) | CONFIRMED     |
| Single-line push 1 h ahead → -3600, suspect, warn log                                                            | acceptance 4                            | http        | `attendance-clock-offset.test.ts`                                              | CONFIRMED     |
| Multi-line push leaves offset unchanged                                                                          | acceptance 5                            | http        | `attendance-clock-offset.test.ts`                                              | CONFIRMED     |
| Real SenseFace 2A shows a small offset after assigning its sede                                                  | acceptance 6                            | http        | `attendance-clock-offset.test.ts` (`it.skip`)                                  | NOT CONFIRMED |
| New columns persisted and rehydrated; legacy row (null site) → nulls                                             | `schema.prisma`, `attendance.mapper.ts` | integration | `prisma-attendance.int.test.ts › PrismaDeviceRepository`                       | CONFIRMED     |
| `assignSite` persisted (siteId + timeZone)                                                                       | `device.ts:143`                         | integration | same                                                                           | CONFIRMED     |
| `listDevices` returns siteId/offset/measuredAt/`clockSuspect` (300 vs -301)                                      | `prisma-attendance.queries.ts`          | integration | `prisma-attendance.int.test.ts › listDevices devuelve sede, desfase…`          | CONFIRMED     |

Observations (no GAP): `measureClockOffset` counts valid lines before de-duplication, so a single-line push that only re-sends an already stored punch is also measured (and looks late). It matches the plan text ("exactly one ATTLOG line") and is the stated limitation class; not tested as intended behavior. In-memory and Prisma `listDevices` apply the same `clockSuspect` rule; the inactive-site path has no HTTP test because organization exposes no deactivate operation (covered at application layer with a stub).

## Review findings

## Verification
