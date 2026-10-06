---
status: testing
module: attendance
min_implementer: mid
depends_on: []
---

# 005 — Targeted writes of the device row

## Context

Fixes the finding `plans/hallazgos/attendance-escritura-completa-del-equipo.md` (review Low-1 of
plan 003), with the approach the user chose on 2026-10-06 (README decision 11).

**What exists today:**

- `PrismaDeviceRepository.save` upserts the **whole** row from the aggregate
  (`apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts:27-42`, data from
  `DeviceMapper.toPersistence`, `infrastructure/attendance.mapper.ts:33-46`).
- Two kinds of writers share that row:
  - Device traffic: `RecordDevicePush` loads the device by serial, measures the clock offset and
    marks it seen, then saves it whole (`application/commands/record-device-push.command.ts:52`,
    `:112-113`); `RecordDeviceContact` does the same for `lastSeenAt`
    (`application/commands/record-device-contact.command.ts:47`, `:54`).
  - Admin: `AssignDeviceSite` loads the device, `assignSite(siteId, timeZone)` and saves it whole
    (`application/commands/assign-device-site.command.ts:27-36`; aggregate
    `domain/device.ts:142-145`).
- Race: a push that loaded the device before a `PUT …/site` and saves after it writes back the old
  `siteId` and `timeZone`; later punches are converted with the old zone. Not reproduced; the
  window is short but falls on installation day.
- `RegisterDevice` is the only creator (`application/commands/register-device.command.ts:53`) and
  needs the upsert's unique-violation mapping to `DeviceAlreadyRegisteredError`
  (`prisma-device.repository.ts:36-40`).
- In-memory repository: `save` stores the object reference
  (`infrastructure/in-memory/in-memory-attendance.store.ts:60-68`).

**Approach.** Each use case that changes an existing device writes only the columns it owns:
two new repository methods, `saveActivity` (`lastSeenAt`, `clockOffsetSeconds`,
`clockOffsetMeasuredAt`) and `saveSite` (`siteId`, `timeZone`), each a Prisma `update` by id.
`save` stays for registration. Alternative considered: an optimistic `version` column — more
general, but needs a migration and a retry/conflict path for the device, which cannot be told to
retry. Rejected by the user (decision 11).

## Out of scope

- The punches of a push in flight during a site change are converted with the zone loaded at the
  start of that push; that is correct for punches that happened before the change and is not
  touched.
- `active` and `name` have no writer besides registration today; no method for them.
- Optimistic versioning, any migration, any contract change.

## Dependencies

None

## Steps

1. **Repository port**
   - Files: `apps/api/src/modules/attendance/domain/device.repository.ts` (modify)
   - Do: add `saveActivity(device: Device): Promise<void>` (docblock: writes only `lastSeenAt`,
     `clockOffsetSeconds`, `clockOffsetMeasuredAt`; used by device traffic) and
     `saveSite(device: Device): Promise<void>` (docblock: writes only `siteId`, `timeZone`; used by
     the admin). Docblock on `save`: full upsert, only for registering a new device; an existing
     device is changed by concurrent writers (device traffic and admin), so each use case writes
     only its columns (finding `attendance-escritura-completa-del-equipo`).
   - Observable result: typecheck lists the two adapters as incomplete.

2. **Adapters**
   - Files: `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify)
   - Do, mapper: `DeviceMapper.toActivity(device)` → `{ lastSeenAt, clockOffsetSeconds,
clockOffsetMeasuredAt }` and `DeviceMapper.toSite(device)` → `{ siteId, timeZone }`.
   - Do, Prisma: `saveActivity` = `attendanceDevice.update({ where: { id: device.id }, data:
DeviceMapper.toActivity(device) })`; `saveSite` likewise with `toSite`. No try/catch: the
     device was just loaded, a missing row is unexpected and must reject.
   - Do, in-memory: both methods read the stored device (missing → reject with an `Error`, as
     Prisma would) and store `Device.restore(stored.id, { ...all props from the stored device's
getters, ...the written fields from the argument })`, so a stale object passed in cannot
     overwrite the other fields (mirrors the Prisma behavior).
   - Observable result: typecheck passes.

3. **Use cases**
   - Files: `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.ts` (modify)
   - Do: `RecordDevicePush` `:113` and `RecordDeviceContact` `:54` call
     `deviceRepository.saveActivity(device)` instead of `save`. `AssignDeviceSite` calls
     `await deviceRepository.saveSite(device)` and drops the `saved.ok` check (`:35-36`); return
     type stays `Command<AssignDeviceSiteInput, void>`.
   - Observable result: `pnpm check` passes with the existing tests unchanged.

4. **Close the finding**
   - Files: `plans/hallazgos/attendance-escritura-completa-del-equipo.md` (modify)
   - Do: frontmatter `status: resolved`, `plan: attendance-marcaciones/005` (the architect already
     set `planned`); one line at the end: resolved by targeted writes.
   - Observable result: `pnpm plans:lint` passes.

## Acceptance criteria

- [ ] Integration (the race, deterministic): two instances of the same device loaded from the DB;
      instance A gets `assignSite(newSite, 'America/Mexico_City')` + `saveSite`; then instance B
      (stale) gets `markSeen` + `recordClockOffset` + `saveActivity`. The row has the new
      `siteId`/`timeZone` **and** B's `lastSeenAt`/offset. Same in the reverse order.
- [ ] Running app: `PUT /api/v1/attendance/devices/:id/site` → 204 and `GET /attendance/devices`
      shows the new sede and zone; a `POST /iclock/cdata?table=ATTLOG` push afterwards still
      updates `lastSeenAt` and keeps the new sede.
- [ ] Running app: `GET /iclock/getrequest` updates `lastSeenAt` (at most once a minute) as before.
- [ ] `POST /api/v1/attendance/devices` still → 201, and a repeated serial → 409
      `DEVICE_ALREADY_REGISTERED`.

## Test layers required

| Layer       | Applies | Focus                                                                                      |
| ----------- | ------- | ------------------------------------------------------------------------------------------ |
| domain      | no      | aggregate unchanged                                                                        |
| application | yes     | push/contact/assign call the targeted method; in-memory stale object does not overwrite    |
| contract    | no      | no contract change                                                                         |
| http        | yes     | acceptance criteria 2–4 over supertest (existing suites must stay green)                   |
| integration | yes     | `saveActivity` / `saveSite` write only their columns; the race of criterion 1, both orders |
| e2e         | no      | (no e2e infrastructure yet)                                                                |

## Deviations

1. **In-memory method takes the written fields explicitly** (cosmetic): `saveActivity`/`saveSite`
   share a private `update(device, fields)` that restores the stored device with those fields;
   same behavior as Step 2.
2. **Environment** (note, no code): the generated Prisma client was stale after a `pnpm install`
   at session start (typecheck failed in every module); `pnpm db:generate` fixed it.
3. **`plans:scope`** against `main` also lists `006-…md` and `007-…md`: they come from the
   plans commit on this branch, not from this plan's code.

Run at the end: `pnpm check` green (api 838 passed / 5 skipped, contracts 259);
`pnpm test:integration` 15 files / 178 tests green. Existing tests unchanged.

## Test coverage

## Review findings

## Verification
