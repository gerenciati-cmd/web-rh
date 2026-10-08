---
status: verify
module: attendance
min_implementer: mid
depends_on: ['005', '006', '008']
---

# 007 — Sync of colaboradores to the checadores

> **Revised 2026-10-08 (back to draft).** Approved on 2026-10-06, before the network barrier
> (plan 008) was integrated. Revised against 008 with README decisions 16, 19 and 20: sync only
> queues for devices with allowed networks, the automatic trigger moves from registration to
> "networks enabled", and a manual sync of a device without networks answers 422. Nothing of
> this plan was implemented before the revision.

## Context

Delivers the sync promised by README decisions 9–10 (organization-sedes decisions 1–4): each
checador holds the colaboradores of its sede, with their RFC as PIN, automatically and on demand;
a colaborador who leaves the sede or the company is removed; users the API did not create are
never touched. Decisions 13–14 (2026-10-06), 16 (no commands without allowed networks) and 19–20
(2026-10-08) apply.

**What exists today:**

- Command channel (after `006`): `DeviceCommand.queue({ id, deviceId, number, command, queuedBy,
now })`, `DeviceCommandRepository.nextNumber/save`, delivery one command per poll with
  `C:<number>:`, results close commands as `DONE`/`FAILED`.
- **Confirmed user-creation text** on the SenseFace 2A (004 Verification, runbook
  `docs/integraciones/zkteco-senseface-2a.md:106`), without the prefix:
  `DATA UPDATE USERINFO PIN=<pin>\tName=<name>\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`.
  `DATA DELETE USERINFO PIN=<pin>` is in the pattern but **not tested** on the device.
- `queuedBy` is a required uuid (`apps/api/prisma/schema.prisma:252`,
  `packages/contracts/src/attendance/device-command.contract.ts:39`); automatic commands have no user.
- Devices: `Device.siteId` (nullable for legacy rows) and `active`
  (`apps/api/src/modules/attendance/domain/device.ts:22-35`); `assignSite` records no event
  (`:174-177`); `RegisterDevice` publishes `DEVICE_REGISTERED` `{ deviceId, serialNumber }`
  (`domain/device.ts:37`, `:105`; `application/commands/register-device.command.ts:55`).
  `AssignDeviceSite` has no `eventBus` (its `Deps`,
  `application/commands/assign-device-site.command.ts:15-18`; it calls `saveSite`, `:35`).
- **Network barrier (plan 008, `done`):** a device is born with `allowedNetworks: []`
  (`domain/device.ts:102`) and `receivesCommands` is `allowedNetworks.length > 0` (`:162-164`).
  `QueueDeviceCommand` refuses to queue for such a device with `DeviceNetworkUnrestrictedError`
  (`application/commands/queue-device-command.command.ts:36-38`, 422
  `DEVICE_NETWORK_UNRESTRICTED`, `packages/contracts/src/errors.ts:303`), and `TakeDeviceCommand`
  delivers nothing to it. `setAllowedNetworks(networks)` records no event
  (`domain/device.ts:185-197`); `SetDeviceNetworks` has deps `deviceRepository, logger` only
  (`application/commands/set-device-networks.command.ts:15-18`, saves at `:36`). So a freshly
  registered device can never receive a user: `DEVICE_REGISTERED` is useless as a sync trigger.
- employees public API (`apps/api/src/modules/employees/index.ts:1-10`):
  - `EmployeesApi.findEmployee` → `EmployeeSummary { id, companyId, email, fullName, rfc,
siteId, active }` (`application/employees.facade.ts:7-15`, `:22`).
  - `listActiveOnSite(siteId)` → `SiteMember { id, companyId, fullName, rfc }`, ACTIVE only,
    ordered (`application/queries/employee.queries.ts:22-27`,
    `infrastructure/prisma-employee.queries.ts:122-134`).
  - Events: `EMPLOYEE_HIRED` `{ employeeId, companyId }`, `EMPLOYEE_TERMINATED`
    `{ employeeId, terminationDate }`, `EMPLOYEE_RFC_ASSIGNED` `{ employeeId }`,
    `EMPLOYEE_SITE_ASSIGNED` `{ employeeId, siteId, previousSiteId }`
    (`domain/employee.ts:36-39`, `:101`, `:121`, `:130`, `:140`).
  - **No termination endpoint exists**: nothing calls `Employee.terminate` outside tests, so
    `EMPLOYEE_TERMINATED` has no producer yet; identity already subscribes to it the same way.
- Subscription pattern to copy: `identity.module.ts:184-195` (`subscribe`, payload checked,
  malformed → throw; the bus logs and isolates handler failures,
  `apps/api/src/infrastructure/events/in-memory-event-bus.ts:22-37`). Importing event names from
  `@/modules/employees` in the module file is allowed (`identity.module.ts:5`).
- Cross-module port pattern to copy: `application/ports/punch-owner-directory.ts` +
  `infrastructure/employees-punch-owner-directory.ts` (adapter over `EmployeesApi`).
- Test container: `employeeQueries.listActiveOnSite` is hand-written
  (`apps/api/tests/test-app.ts:133-147`); subscriptions are wired only when a test calls
  `wireSubscriptions(container)` (`apps/api/tests/invitations.test.ts:424`).

**Approach.** A small registry `attendance.device_users` remembers which PIN the API put on which
device for which colaborador (needed by decision 4 "never delete what we did not create" and to
find the old PIN after an RFC change). Two use cases:

- `SyncDevice` (reconcile one device with its sede): UPDATE for every active member with RFC,
  DELETE for every registry row whose colaborador is no longer a member. Triggered manually
  (`POST …/devices/:id/sync`) and by two new device events: `DEVICE_SITE_ASSIGNED` and
  `DEVICE_COMMANDS_ENABLED` (allowed networks go from empty to non-empty, decision 19). A device
  without allowed networks is not synced: manual → 422 `DEVICE_NETWORK_UNRESTRICTED`, automatic →
  warn log (decision 20).
- `SyncEmployee` (reconcile one colaborador across devices): triggered by the four employees
  events. Desired = the active devices of their sede, only if active and with RFC; extra registry
  rows → DELETE; missing ones → UPDATE. A device without allowed networks is skipped (no UPDATE,
  no DELETE) with a warn log; its own `DEVICE_COMMANDS_ENABLED` sync catches it up later.

**The barrier gate lives in `DeviceUserSync`** (every sync command passes through it), not only in
the use cases: the sync queues with `DeviceCommand.queue` + `save` directly, bypassing
`QueueDeviceCommand` and its check, so without its own gate it would queue RFC + name for an
unrestricted device and write registry rows for users that never arrive. Alternative considered:
route the sync through `QueueDeviceCommand` — rejected: it takes a required `queuedBy` user and
knows nothing of the `device_users` registry, so the sync would still need its own write path.

The registry row is written when the command is **queued** (not when it is DONE): the bitácora
already shows failures, and a manual sync re-sends everything. An identical command still QUEUED
for the same device is not queued twice. Alternative considered: deriving "what is on the
device" from the bitácora — fragile (texts, failures, manual commands). Alternative: querying the
device's user list (`QUERY`) — unconfirmed reply format.

## Out of scope

- A termination endpoint (the subscription is ready; the producer is another plan).
- More than one command per poll; retries of FAILED commands; a "users on this device" endpoint.
- PIN for colaboradores without RFC (decision 13: skipped and reported).
- Name truncation or transliteration for the device (unknown limits; the verifier observes them).
- Web/mobile screens; changing the probe endpoint of 004/006.

## Dependencies

- `005` — `DeviceRepository.saveSite` used by `AssignDeviceSite`.
- `006` — `DeviceCommand.queue` with `number`, `DeviceCommandRepository.nextNumber`, `wireText`,
  statuses `DONE`/`FAILED`, `DEVICE_COMMAND_PATTERN` without prefix.
- `008` — `Device.receivesCommands`, `setAllowedNetworks`, `SetDeviceNetworks`,
  `DeviceNetworkUnrestrictedError` / `DEVICE_NETWORK_UNRESTRICTED`, `saveAllowedNetworks`
  (`done` on 2026-10-08).

## Steps

1. **Contract**
   - Files: `packages/contracts/src/attendance/device-command.contract.ts` (modify), `packages/contracts/src/attendance/device.contract.ts` (modify), `packages/contracts/src/errors.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do: `DeviceCommandSchema.queuedBy` → `z.uuid().nullable()` (`'Usuario que lo encoló; null si
lo encoló la sincronización automática'`). New `DeviceSyncResultSchema`
     (`.meta({ id: 'AttendanceDeviceSyncResult' })`): `queued: z.number().int()` (UPDATE commands
     queued), `removed: z.number().int()` (DELETE commands queued), `skipped:
z.array(z.object({ employeeId: z.uuid(), fullName: z.string(), reason: z.enum(['NO_RFC'])
}))`. Route `syncDevice` in `attendanceDeviceRoutes`: `POST /attendance/devices/:deviceId/sync`,
     summary `'Sincroniza los colaboradores de la sede con el checador'`, description in the
     style of the other routes (solo administrador del holding; encola comandos; colaboradores
     sin RFC se reportan en `skipped`; el checador debe tener redes permitidas),
     `errors: ['DEVICE_NOT_FOUND', 'DEVICE_WITHOUT_SITE', 'DEVICE_NETWORK_UNRESTRICTED']`,
     `requires('attendance.devices:manage')`, response `DeviceSyncResultSchema`, status 200.
     Error catalog: `DEVICE_WITHOUT_SITE` (422, `'El checador no tiene sede asignada'`,
     details `{ deviceId: DEVICE_ID }`) after `DEVICE_NETWORK_UNRESTRICTED`. In the
     `setDeviceNetworks` route description (`device.contract.ts:127-139`) add one sentence: al
     pasar de sin redes a con redes, el checador se sincroniza con su sede. Regenerate; operation
     count +1.
   - Observable result: contracts tests pass.

2. **Domain**
   - Files: `apps/api/src/modules/attendance/domain/device-user.ts` (create), `apps/api/src/modules/attendance/domain/device-user.repository.ts` (create), `apps/api/src/modules/attendance/domain/device-user-commands.ts` (create), `apps/api/src/modules/attendance/domain/device.ts` (modify), `apps/api/src/modules/attendance/domain/device-command.ts` (modify), `apps/api/src/modules/attendance/domain/errors.ts` (modify), `apps/api/src/modules/attendance/domain/device.repository.ts` (modify), `apps/api/src/modules/attendance/domain/device-command.repository.ts` (modify)
   - Do, `device-user.ts`: `interface DeviceUser { deviceId: DeviceId; pin: string; employeeId:
string; syncedAt: Date }` (plain value: no behavior). Repository port: `listByDevice(deviceId)`,
     `listByEmployee(employeeId)`, `put(user: DeviceUser): Promise<void>` (insert or replace by
     `(deviceId, pin)`), `remove(deviceId, pin): Promise<void>`.
   - Do, `device-user-commands.ts`: `upsertUserCommand(pin, name): string` → the confirmed text
     of Context with `name` sanitized (every `\p{Cc}` incl. tab → space, collapse spaces, trim);
     `deleteUserCommand(pin): string` → `DATA DELETE USERINFO PIN=<pin>`. Docblock: UPDATE
     confirmed 2026-10-03; DELETE pending confirmation (plan 007 verification).
   - Do, `device.ts`: `DEVICE_SITE_ASSIGNED = 'attendance.device.site-assigned'`; `assignSite(siteId,
timeZone, now: Date)` records it `{ deviceId, siteId, previousSiteId }` only when the site
     changes (zone still copied every time). `DEVICE_COMMANDS_ENABLED =
'attendance.device.commands-enabled'`; `setAllowedNetworks(networks, now: Date)` records it
     `{ deviceId }` only when `receivesCommands` goes from `false` to `true` (not when a
     non-empty list is replaced by another, not when it is emptied; again on each re-enable).
   - Do, `device-command.ts`: `queuedBy: string | null` in props and `queue` input.
   - Do, errors: `DeviceWithoutSiteError extends BusinessRuleViolationError`
     (`override readonly code = 'DEVICE_WITHOUT_SITE'`, `'El checador no tiene sede asignada'`,
     `{ deviceId }`).
   - Do, `DeviceRepository`: `listActiveBySite(siteId: string): Promise<Device[]>`.
   - Do, `DeviceCommandRepository`: `hasQueued(deviceId: DeviceId, command: string):
Promise<boolean>` (an identical command, without prefix, still `QUEUED` for that device).
   - Observable result: typecheck lists the callers to update.

3. **Port to employees**
   - Files: `apps/api/src/modules/attendance/application/ports/site-roster.ts` (create), `apps/api/src/modules/attendance/infrastructure/employees-site-roster.ts` (create)
   - Do: `interface RosterMember { employeeId: string; fullName: string; rfc: string | null }`;
     `interface SiteRoster { activeMembers(siteId): Promise<RosterMember[]>; findPlacement(employeeId):
Promise<{ member: RosterMember; siteId: string | null; active: boolean } | null> }`.
     Adapter `EmployeesSiteRoster` over `employeesApi.listActiveOnSite` and `findEmployee`
     (shape of `employees-punch-owner-directory.ts`).
   - Observable result: `pnpm arch:check` passes.

4. **Application**
   - Files: `apps/api/src/modules/attendance/application/commands/sync-device.command.ts` (create), `apps/api/src/modules/attendance/application/commands/sync-employee.command.ts` (create), `apps/api/src/modules/attendance/application/device-user-sync.ts` (create), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/set-device-networks.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.ts` (modify)
   - Do, `device-user-sync.ts` (shared helper, class `DeviceUserSync`, deps
     `deviceCommandRepository, deviceUserRepository, idGenerator, clock, logger`):
     **first line of `push` and `remove`: if `!device.receivesCommands` → return `'unrestricted'`
     without queuing or touching the registry** (decision 16; this is the gate, see Approach).
     `push(device, member, queuedBy)` → skip if an identical command is QUEUED for the device
     (`hasQueued`, step 2), else `nextNumber` + `DeviceCommand.queue` + `save` + `deviceUserRepository.put`;
     `remove(device, pin, queuedBy)` → same with the DELETE text and `remove`. A `queue` error
     (e.g. text over 500) → warn `'zkteco: comando de sincronización inválido'`
     `{ deviceId, employeeId }`, counted as skipped. Logs carry ids and counts, never PIN or name.
   - Do, `SyncDevice` (`Command<{ deviceId: string; queuedBy: string | null }, DeviceSyncResult>`
     with the contract DTO type): device missing → `DeviceNotFoundError`; no `siteId` →
     `DeviceWithoutSiteError`; inactive device → `ok` with zeros (nothing to sync);
     `!device.receivesCommands` → `DeviceNetworkUnrestrictedError(device.id)` (the event handler
     of step 6 logs it at warn, decision 20);
     members = `activeMembers(siteId)`; with RFC → `push`; without → `skipped` `NO_RFC`;
     registry rows of the device whose `pin` is not a member RFC → `remove`. Info log
     `'zkteco: sincronización de checador'` `{ deviceId, queued, removed, skipped }`.
   - Do, `SyncEmployee` (`UseCase<{ employeeId: string }, void>`): placement =
     `findPlacement`; desired devices = active devices of `siteId` when placement exists,
     `active`, `rfc !== null` and `siteId !== null`, else none; for each registry row of the
     employee not matching (device not desired, or `pin !== rfc`) → `remove`; for each desired
     device without a row with that pin → `push`. `queuedBy: null`. Every device whose `push` or
     `remove` returned `'unrestricted'` → one warn per device
     `'zkteco: checador sin redes, sincronización omitida'` `{ deviceId, employeeId }`.
   - Do, `AssignDeviceSite`: dep `eventBus` + `clock`; `assignSite(site.id, site.timeZone,
clock.now())`; publish `pullEvents()` after `saveSite`.
   - Do, `SetDeviceNetworks`: dep `eventBus` + `clock`; `setAllowedNetworks(input.allowedNetworks,
clock.now())`; publish `pullEvents()` after `saveAllowedNetworks` (same shape as
     `register-device.command.ts:55`).
   - Do, `QueueDeviceCommand`: no behavior change; `queuedBy` type follows the entity.
   - Observable result: typecheck passes.

5. **Persistence**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/YYYYMMDDHHMMSS_create_device_users/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/prisma-device-user.repository.ts` (create), `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-device-command.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify)
   - Do, schema: `AttendanceDeviceCommand.queuedBy String? @map("queued_by") @db.Uuid`; new
     model `AttendanceDeviceUser` → `attendance.device_users`: `deviceId` (FK to devices, same
     module), `pin VarChar(32)`, `employeeId Uuid` (`/// referencia por id a employees, sin FK
(ADR 0010)`), `syncedAt Timestamptz(3)`; `@@id([deviceId, pin])`, `@@index([employeeId])`.
     Back-relation `users` on `AttendanceDevice`. `pnpm db:migrate --name create_device_users`:
     only `CREATE TABLE`, index, FK and `ALTER COLUMN queued_by DROP NOT NULL`. Replace the
     placeholder; note in Deviations.
   - Do, repositories: `PrismaDeviceUserRepository` (`put` = upsert on the composite key);
     `PrismaDeviceRepository.listActiveBySite` = `findMany({ where: { siteId, active: true },
orderBy: [{ name: 'asc' }, { id: 'asc' }] })`; Prisma `hasQueued` = `count({ where: {
deviceId, command, status: 'QUEUED' } }) > 0`. Mapper
     handles nullable `queuedBy`. In-memory: `deviceUsers` map keyed `deviceId|pin`,
     `InMemoryDeviceUserRepository`, `listActiveBySite`, `hasQueued`.
   - Observable result: migration applied; typecheck passes.

6. **HTTP, subscriptions, module**
   - Files: `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do: bind `syncDevice` (`queuedBy: requireActor(ctx).userId`). Register `siteRoster`
     (`EmployeesSiteRoster`), `deviceUserRepository` (Prisma), `deviceUserSync`, `syncDevice`,
     `syncEmployee`. `subscribe` (shape of `identity.module.ts:184-195`, one small helper that
     reads a string field from the payload or throws): `EMPLOYEE_HIRED`, `EMPLOYEE_SITE_ASSIGNED`,
     `EMPLOYEE_RFC_ASSIGNED`, `EMPLOYEE_TERMINATED` → `syncEmployee.execute({ employeeId })`;
     `DEVICE_COMMANDS_ENABLED`, `DEVICE_SITE_ASSIGNED` → `syncDevice.execute({ deviceId, queuedBy:
null })` (an `err` result is logged at warn with its `code`, not thrown; for
     `DEVICE_SITE_ASSIGNED` on a device without networks this is the expected path).
     `DEVICE_REGISTERED` is **not** subscribed (decision 19: a new device has no networks). `test-app.ts`: in-memory
     `deviceUserRepository`.
   - Observable result: `tests/container.test.ts` resolves the new keys; `pnpm check` passes.

7. **Docs**
   - Files: `docs/integraciones/zkteco-senseface-2a.md` (modify), `docs/harness/modules.json` (modify)
   - Do: runbook section "Sincronización de colaboradores": what triggers it (giving the device
     its allowed networks, changing its sede, the employees events, or the manual endpoint; never
     the registration alone: order is register → `PUT …/networks` → users arrive), devices without
     networks are skipped with the warn of step 4 (add it to the log table), PIN = RFC,
     colaboradores without RFC are skipped (`skipped` in the response), users not created by the
     API are never deleted, one command per poll (~10 s each: a sede of 100 people takes ~17 min),
     how to check it (bitácora `DONE`/`FAILED`), DELETE pending confirmation until this plan's
     verification. `modules.json` attendance summary: add "Syncs sede colaboradores to devices".
   - Observable result: `pnpm check` passes.

8. **Existing tests forced by the change** (fixtures only)
   - Files: `apps/api/src/modules/attendance/application/commands/assign-device-site.command.test.ts` (modify), `apps/api/src/modules/attendance/domain/device.test.ts` (modify), `apps/api/src/modules/attendance/domain/device-networks.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.test.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-device.repository.test.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.test.ts` (modify), `apps/api/tests/attendance-device-commands.test.ts` (modify), `packages/contracts/src/attendance/device-command.contract.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-device-networks.int.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-device-command.int.test.ts` (modify)
   - Do: `assignSite` and `setAllowedNetworks` get `now` in every caller of these files (found
     with `grep -rn "assignSite(\|setAllowedNetworks(" apps/api` on 2026-10-08; any new one goes in
     Deviations); `AssignDeviceSite` and `SetDeviceNetworks` get `eventBus`/`clock` fakes; contract
     test for nullable `queuedBy`. No new cases (the tester adds them).
   - Observable result: `pnpm check` and `pnpm test:integration` pass.

## Acceptance criteria

- [ ] Sede S with colaboradores A (RFC), B (RFC) and C (a legacy row without RFC: hiring in
      México requires one); a device registered in S → **no** command yet. `PUT …/networks` with
      a network → the bitácora shows two `QUEUED` UPDATE commands (A and B, `queuedBy: null`),
      none for C. Replacing the networks with another non-empty list → no new commands.
- [ ] `POST …/devices/:id/sync` as HOLDING_ADMIN → 200 `{ queued, removed, skipped: [C, NO_RFC] }`;
      repeated before the device polls → no duplicate QUEUED commands. HR → 403; unknown device →
      404 `DEVICE_NOT_FOUND`; a legacy device without sede → 422 `DEVICE_WITHOUT_SITE`; a device
      without allowed networks → 422 `DEVICE_NETWORK_UNRESTRICTED` and nothing queued.
- [ ] Sede S with one device with networks and one without: hiring D in S → UPDATE only for the
      first; the log has `zkteco: checador sin redes, sincronización omitida` with the second's
      `deviceId`; `device_users` has no row for the second. Giving it networks → it gets every
      member of S.
- [ ] Hire D in S with RFC → one UPDATE for D on every active device of S that has networks. `PUT …/employees/D/site`
      to sede T → DELETE of D's PIN on S's devices and UPDATE on T's. `PUT …/rfc` with a new RFC →
      DELETE old PIN + UPDATE new PIN.
- [ ] A synthetic `EMPLOYEE_TERMINATED` for A → DELETE of A's PIN (application/http test; no
      producer in the running app).
- [ ] `PUT …/devices/:id/site` to another sede → DELETE for the old sede's synced PINs, UPDATE for
      the new sede's members; device users not in `device_users` get nothing.
- [ ] No log line contains an RFC or a name from the sync.
- [ ] **Real device:** after sync the colaboradores appear in the device user list with their RFC;
      a name with accents (e.g. `José Peña`) displays correctly or the result is recorded; a
      DELETE removes the user and ends `DONE`; users "1" and "2" stay. NOT VERIFIED without the
      device.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                      |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | command texts and name sanitizing; `assignSite` event only on change; `setAllowedNetworks` event only on false→true; nullable `queuedBy`                                   |
| application | yes     | `SyncDevice` (all paths, no duplicates, never deletes foreign PINs, 422 without networks); `SyncEmployee` per event, skips devices without networks; `DeviceUserSync` gate |
| contract    | yes     | sync route, result schema, `DEVICE_WITHOUT_SITE`, `DEVICE_NETWORK_UNRESTRICTED` on the route, nullable `queuedBy`                                                          |
| http        | yes     | acceptance criteria 1–7 with `wireSubscriptions` on the test container                                                                                                     |
| integration | yes     | `device_users` repository, `listActiveBySite`, `hasQueued`, nullable `queued_by`                                                                                           |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                |

## Deviations

- Step 5: la migración quedó como `20261008204154_create_device_users` (generada por `pnpm db:migrate`; no hubo placeholder que reemplazar). Solo contiene `ALTER COLUMN queued_by DROP NOT NULL`, `CREATE TABLE`, índice y FK.
- Step 6: el warn de una sincronización automática rechazada (`DEVICE_NETWORK_UNRESTRICTED`, etc.) lo escribe `SyncDevice` cuando `queuedBy === null`, no el handler de `subscribe`: el cradle de `subscribe` no expone `logger` y agregarlo exigiría un registro nuevo. Mismo mensaje y nivel; el handler no lanza.
- Step 8: `queue-device-command.command.ts` y `attendance-device-commands.test.ts` no necesitaron cambios. Los callers de `assignSite`/`setAllowedNetworks` pasan la fecha literal `new Date('2026-10-08T12:00:00Z')`. La suite de integración existente pasa (199 tests).
- Reparación 2026-10-08 (decisión 21; reemplaza la regla "comando idéntico en cola no se repite" del Approach): `hasQueued` pasó a `lastQueuedForPin(deviceId, pin): Promise<string | null>` (Prisma `findFirst` con `OR` delete/`startsWith` prefijo UPDATE, `queuedAt desc, id desc`; en memoria, mismo orden). `domain/device-user-commands.ts` exporta `upsertUserPrefix` y `targetsPin`. `DeviceUserSync.enqueue` marca `'duplicate'` solo si el último comando en cola de ese PIN es idéntico; recibe `{ text, pin, employeeId }` como un objeto para no pasar de 4 parámetros (lint `max-params`). Tests adaptados mecánicamente: solo `tests/integration/attendance/prisma-device-user.int.test.ts` (las 3 aserciones de `hasQueued`, más la constante `PIN`); ningún test unitario llamaba `hasQueued`. Los casos nuevos (los dos escenarios del hallazgo 1 y S→T→S de un checador) son del tester. Hallazgo 2: warn `zkteco: sincronización omitida` agregado a la tabla de logs del runbook. Hallazgo 3: aceptado sin cambio. La evidencia previa de testing/review (arriba) queda superada por esta reparación y debe repetirse.
- Step 4: `SyncEmployee` se partió en `findTarget`, `removeStale` y `addMissing` solo para bajar la complejidad ciclomática; sin cambio de comportamiento.

## Test coverage

Tester, 2026-10-08, **segunda pasada tras la reparación de la revisión (commit 4d748a5, decisión 21)**. Baseline `pnpm check` verde (api 1096 passed | 5 skipped). Cierre: `pnpm check` verde (api 1111 passed | 5 skipped; contracts 295) y `pnpm test:integration` verde (218 passed, 17 archivos; antes 214). Sin GAP ni NOT CONFIRMED. La cobertura de la primera pasada (1096 tests api, 214 de integración; evidencia del 2026-10-08 anterior a la reparación) queda **superada** donde la tabla marca "REEMPLAZADO": la regla "comando idéntico en cola no se repite" (`hasQueued`) ya no existe. Los fixtures de los pasos 1-8 los dejó el implementer; aquí solo hay casos nuevos.

| Comportamiento (plan / código)                                                                                                                                                        | Capa        | Test                                                                                                                         | Estado                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| UPDATE confirmado (texto exacto), nombre saneado (`\p{Cc}`, espacios), DELETE por PIN                                                                                                 | domain      | `domain/device-user-commands.test.ts`                                                                                        | CONFIRMED                                      |
| `assignSite` registra `DEVICE_SITE_ASSIGNED` solo si cambia la sede; la zona se copia siempre                                                                                         | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `setAllowedNetworks` registra `DEVICE_COMMANDS_ENABLED` solo en vacío→no vacío (otra vez al rehabilitar)                                                                              | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `DeviceCommand.queue` acepta `queuedBy: null`; `DeviceWithoutSiteError`                                                                                                               | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `AssignDeviceSite` / `SetDeviceNetworks` publican los eventos (y nada si no hay cambio o es inválido)                                                                                 | application | `application/commands/device-sync-triggers.test.ts`                                                                          | CONFIRMED                                      |
| Compuerta de la barrera en `push`/`remove` (sin cola ni registro), duplicado (solo si el último en cola del PIN es idéntico), invalid, `queued`                                       | application | `application/device-user-sync.test.ts`                                                                                       | CONFIRMED                                      |
| `SyncDevice`: altas, NO_RFC, sin duplicar, bajas, no toca PIN ajenos, 404/422 sede/422 redes, inactivo, `queuedBy` null + warn, logs sin RFC/nombre, texto >500                       | application | `application/commands/sync-device.command.test.ts`                                                                           | CONFIRMED                                      |
| `SyncEmployee`: alta, idempotencia, equipos inactivos, cambio de sede/RFC, baja, sin RFC/sede, equipo sin redes omitido (alta y baja) con un warn, equipo borrado                     | application | `application/commands/sync-employee.command.test.ts`                                                                         | CONFIRMED                                      |
| Repositorio en memoria de `device_users` (mismo contrato que Prisma)                                                                                                                  | application | `infrastructure/in-memory/in-memory-device-user.repository.test.ts`                                                          | CONFIRMED                                      |
| `DeviceSyncResultSchema`, ruta `syncDevice` (POST, permiso, errores), `DEVICE_WITHOUT_SITE` en el catálogo                                                                            | contract    | `packages/contracts/src/attendance/device-sync.contract.test.ts` (+ `queuedBy` null ya en `device-command.contract.test.ts`) | CONFIRMED                                      |
| Criterio 1: registrar no encola; poner redes encola A y B (no C sin RFC, `queuedBy` null); cambiar redes no repite                                                                    | http        | `tests/attendance-device-sync.test.ts › criterio 1`                                                                          | CONFIRMED                                      |
| Criterio 2: 200 + NO_RFC sin duplicar; encola faltantes y da de baja; HR 403, 401, 404, 400, 422 sin sede, 422 sin redes                                                              | http        | `tests/attendance-device-sync.test.ts › criterio 2`                                                                          | CONFIRMED                                      |
| Criterio 3: equipo con redes y otro sin; warn con `deviceId`; sin fila en el registro; al habilitarlo recibe a la sede                                                                | http        | `tests/attendance-device-sync.test.ts › criterio 3`                                                                          | CONFIRMED                                      |
| Criterio 4: alta, `PUT …/site`, `PUT …/rfc`                                                                                                                                           | http        | `tests/attendance-device-sync.test.ts › criterio 4`                                                                          | CONFIRMED                                      |
| Criterio 5: `EMPLOYEE_TERMINATED` sintético → DELETE                                                                                                                                  | http        | `tests/attendance-device-sync.test.ts › criterio 5`                                                                          | CONFIRMED                                      |
| Criterio 6: `PUT …/devices/:id/site` → DELETE de la sede vieja, UPDATE de la nueva; registro queda con la nueva                                                                       | http        | `tests/attendance-device-sync.test.ts › criterio 6`                                                                          | CONFIRMED                                      |
| Criterio 7: ningún log de la sincronización lleva RFC ni nombre                                                                                                                       | http        | `tests/attendance-device-sync.test.ts › criterio 7`                                                                          | CONFIRMED                                      |
| Payload malformado en las suscripciones no rompe al publicador ni encola                                                                                                              | http        | `tests/attendance-device-sync.test.ts › suscripciones`                                                                       | CONFIRMED                                      |
| OpenAPI documenta el POST de sync con `attendance.devices:manage`                                                                                                                     | http        | `tests/attendance-device-sync.test.ts › OpenAPI`                                                                             | CONFIRMED                                      |
| Migración: columnas de `device_users`, `queued_by` nullable, sin FK a employees (ADR 0010)                                                                                            | integration | `tests/integration/attendance/prisma-device-user.int.test.ts › migración`                                                    | CONFIRMED                                      |
| `put` upsert, `listByDevice`/`listByEmployee`, `remove` idempotente, FK a devices                                                                                                     | integration | `prisma-device-user.int.test.ts › PrismaDeviceUserRepository`                                                                | CONFIRMED                                      |
| `listActiveBySite` (solo activos, orden por nombre); `hasQueued` (REEMPLAZADO por `lastQueuedForPin`, filas nuevas abajo); `queuedBy` null persiste                                   | integration | `prisma-device-user.int.test.ts › listActiveBySite / hasQueued`                                                              | CONFIRMED                                      |
| `targetsPin` / `upsertUserPrefix`: reconoce UPDATE y DELETE de ese PIN; no confunde un PIN que lo contiene como prefijo, otro PIN ni un QUERY                                         | domain      | `domain/device-user-commands.test.ts › upsertUserPrefix y targetsPin`                                                        | CONFIRMED                                      |
| `DeviceUserSync`: duplicado solo si el ÚLTIMO en cola del PIN es idéntico; con el contrario después, se encola (UPDATE, DELETE, UPDATE; registro queda); DELETE repetido es duplicate | application | `application/device-user-sync.test.ts › si el último comando en cola…`, `› con el DELETE como último…`                       | CONFIRMED (reemplaza la regla `hasQueued`)     |
| Caso B del hallazgo 1: S → T → S con la cola sin vaciar deja UPDATE final en los equipos de S y el registro de vuelta                                                                 | application | `sync-employee.command.test.ts › caso B…`                                                                                    | CONFIRMED                                      |
| Caso A del hallazgo 1: alta entregada, sale, vuelve y sale otra vez antes de consultar: el DELETE final se encola y no queda fila en S                                                | application | `sync-employee.command.test.ts › caso A…`                                                                                    | CONFIRMED                                      |
| Cambio de sede del checador S → T → S: baja y alta finales se encolan, el registro conserva al colaborador; DELETE como último en cola no se duplica                                  | application | `sync-device.command.test.ts › cambio de sede del checador…`, `› con el DELETE como último…`                                 | CONFIRMED                                      |
| `lastQueuedForPin` en memoria: null sin comandos; el más reciente por `queuedAt`; desempate por id mayor; ignora otro equipo/PIN/prefijo/QUERY/no QUEUED                              | application | `infrastructure/in-memory/in-memory-device-command.repository.test.ts`                                                       | CONFIRMED                                      |
| `lastQueuedForPin` Prisma (`OR` delete/`startsWith` + `queuedAt desc, id desc`): último gana, desempate por id, ignora otro PIN/prefijo/QUERY, un comando fuera de cola no cuenta     | integration | `prisma-device-user.int.test.ts › lastQueuedForPin: el último comando en cola del PIN decide`                                | CONFIRMED                                      |
| Criterio 8: dispositivo real (usuarios aparecen, acentos, DELETE termina `DONE`, usuarios "1" y "2" intactos)                                                                         | e2e/real    | no aplica a tests automatizados                                                                                              | NOT VERIFIED (verificador, necesita el equipo) |

Notas: (1) el texto del DELETE sigue sin confirmarse en el equipo; los tests fijan el texto del plan, no su efecto. (2) La bitácora (`GET …/commands`) no garantiza orden cronológico estable entre comandos del mismo instante: los tests http comparan por conjunto/ordenado. (3) Pase de cierre: el primer `pnpm check` falló por lint en mis tests (`no-unsafe-return`, `import-x/order`); se corrigió y el segundo pasó, así que fueron tres corridas completas de `check` en vez de dos. (4) Segunda pasada: `pnpm check` verde a la primera (sin la corrida extra de la primera pasada); el caso A se arma marcando el alta como entregada (`markSent`) antes de los cambios de sede. Los tests de `SyncDevice` y `DeviceUserSync` previos ("repetido no duplica", "idéntico en cola da duplicate") siguen válidos bajo la regla nueva (el último en cola es idéntico).

## Review findings

Reviewer, 2026-10-08, diff `main...HEAD` (d6b18a1, 11170af, 373ec0f; worktree limpio).

**Checklist: 13/13 pasan; queda un hallazgo de bug hunt que pide cambio de código.**

- [x] `pnpm plans:scope`: sale con código 1, pero todo se explica. Los 10 "fuera de alcance" son
      archivos de test nuevos del tester (permitido). En "declarados sin cambios" están la ruta
      placeholder de la migración (la real es `20261008204154_create_device_users`, Deviations
      paso 5), `queue-device-command.command.ts` y `attendance-device-commands.test.ts`
      (Deviations paso 8). Hot files: `test-app.ts` (+2 líneas, solo agregadas),
      `modules.json` (frase agregada al summary, paso 7), `schema.prisma` (modelo nuevo
      agregado; la back-relation `users` y `queuedBy String?` son cambios declarados en el paso 5).
- [x] `pnpm check` en verde (api 89 archivos / 1096 passed / 5 skipped; contracts 295; arch: sin
      violaciones; plans lint, harness, hooks, bootstrap, quality).
- [x] `pnpm test:integration` en verde (17 archivos / 214 tests).
- [x] Las reglas de negocio están en el dominio (`assignSite`/`setAllowedNetworks` emiten los
      eventos, textos de los comandos en `domain/device-user-commands.ts`). Router y mappers no
      tienen lógica.
- [x] CQRS: `SyncDevice` devuelve `Result`; los repositorios no tienen métodos para pantallas
      (`listActiveBySite`/`hasQueued` los usan los commands).
- [x] Los tipos vienen de contratos (`DeviceSyncResultDto`); `openapi.json` regenerado.
- [x] Errores: `DeviceWithoutSiteError` con `DEVICE_WITHOUT_SITE` (422) está en el catálogo; no
      se filtra nada interno.
- [x] El tiempo pasa por `Clock` (`now` en `assignSite`/`setAllowedNetworks`/`syncedAt`) y los
      ids por `IdGenerator`. No hay dinero.
- [x] La migración es nueva: `DROP NOT NULL`, `CREATE TABLE`, índice y FK solo a
      `attendance.devices` (mismo módulo). Ningún DROP inesperado y ninguna FK a employees.
- [x] DI: `container.test.ts` en verde; el módulo se registra una sola vez.
- [x] Sin secretos ni datos personales reales (RFC y nombres de prueba sintéticos).
- [x] Deviations: comprobé el paso 6. `AppModule.subscribe` recibe `TCradle & { eventBus }`
      (`apps/api/src/shared/app-module.ts:29`) y `AttendanceCradle` no expone `logger`, así que
      la afirmación es cierta.
- [x] Docs al día: runbook (sección nueva y tabla de logs) y `modules.json`.

### Findings

**Medium (requiere cambio de código)**

1. **Saltarse un comando "idéntico ya en cola" no mira si después quedó en cola el comando
   contrario para el mismo PIN, y el equipo puede terminar en el estado opuesto al registro.**
   Está en `apps/api/src/modules/attendance/application/device-user-sync.ts:447` (`hasQueued` →
   `'duplicate'`), y `push` (`:410-417`) y `remove` (`:434-436`) igual actualizan el registro
   `device_users`. La entrega va en orden FIFO (`prisma-device-command.repository.ts:24`,
   `queuedAt asc`), así que el estado final del equipo lo decide el **último** comando en cola
   para ese PIN, no la existencia de uno idéntico. El código cumple el texto del plan ("An
   identical command still QUEUED … is not queued twice"): la falla está en la regla misma.
   - Caso B (dos cambios en la ventana): la sincronización inicial encola el UPDATE X de E (n1,
     QUEUED) y pone la fila. RH mueve a E a la sede T por error: DELETE X (n2) y se borra la
     fila. RH lo regresa a S: `hasQueued(UPDATE X)` da verdadero porque n1 sigue en cola →
     `'duplicate'` → se pone la fila sin encolar nada. El equipo ejecuta n1 y luego n2, y **E
     no queda en el checador aunque el registro diga que sí**. Ningún evento automático lo
     corrige; solo una sincronización manual hecha cuando la cola ya se vació.
   - Caso A (tres cambios): E está en dS (DONE). Se mueve a T: DELETE X (n1, QUEUED). Regresa
     a S: UPDATE X (n2), se pone la fila. Se mueve a T otra vez antes de que dS consulte:
     `hasQueued(DELETE X)` da verdadero por n1 → `'duplicate'` → se borra la fila. El equipo
     ejecuta n1 y luego n2: **E sigue en dS sin fila en el registro**, así que ninguna
     sincronización lo vuelve a borrar. Rompe las decisiones 9–10 (quien sale de la sede se
     quita) y la persona puede seguir marcando.
   - La ventana es real: una sede de 100 personas tarda ~17 min en vaciar la cola (runbook). El
     cambio de sede de un checador S→T→S tiene el mismo problema, vía el bucle de bajas de
     `SyncDevice` (`sync-device.command.ts:240-244`).
   - Sugerencia (no aplicada): saltarse el comando solo si el **último** comando QUEUED para
     ese equipo y PIN es idéntico. Esto cambia la regla del plan, así que va como deviation o
     decisión del usuario. No hay test que lo cubra: los tests fijan la regla actual.

**Low (no bloquean)**

2. `sync-device.command.ts:204`: el warn `'zkteco: sincronización omitida'` (una sincronización
   automática rechazada por `DEVICE_NOT_FOUND`/`DEVICE_WITHOUT_SITE`) no está en la tabla de
   logs del runbook. Casi nunca se alcanza, porque `DEVICE_SITE_ASSIGNED` siempre trae sede.
3. Dos sincronizaciones concurrentes (un evento y la manual) pueden pasar las dos `hasQueued` y
   encolar UPDATE duplicados (`device-user-sync.ts:447-464`, sin lock). No hace daño porque el
   UPDATE es idempotente; solo alarga la cola. No lo reproduje: sale de leer el código.

Status: se queda en `review` (el hallazgo 1 pide cambio de código y probablemente una
decisión sobre la regla de no duplicar).

### Repair (main session, 2026-10-08)

The user decided the rule (README decision 21): **a sync command is skipped only when the most
recent QUEUED command for that device and that PIN is identical**; if the most recent one is
the opposite (or an UPDATE with another text), the new command is queued. This replaces the
Approach sentence "An identical command still QUEUED for the same device is not queued twice".
Status `review` → `implementing` for the repair; after it, testing → review → verify again.

Scope of the repair (implementer):

- Finding 1 (Medium):
  - `domain/device-command.repository.ts`: replace `hasQueued(deviceId, command)` with
    `lastQueuedForPin(deviceId: DeviceId, pin: string): Promise<string | null>`, the text of the
    most recent `QUEUED` command of the device that targets `pin`, in the reverse of the
    delivery order (`queuedAt desc, id desc`; delivery is `asc`,
    `infrastructure/prisma-device-command.repository.ts:24`); `null` if none.
  - "Targets `pin`" = the text equals `deleteUserCommand(pin)` or starts with the UPDATE prefix
    for that pin (`DATA UPDATE USERINFO PIN=<pin>` followed by a tab). Export both matchers from
    `domain/device-user-commands.ts` so the texts and the matchers cannot drift apart.
  - Prisma: `findFirst` with `OR: [{ command: <delete text> }, { command: { startsWith: <update
prefix> } }]`, `status: 'QUEUED'`, `deviceId`, ordered `queuedAt desc, id desc`, selecting
    `command`. In-memory: same rule over the store, same order.
  - `application/device-user-sync.ts` `enqueue(device, text, pin, …)`: `'duplicate'` only when
    `lastQueuedForPin(device.id, pin) === text`. `push`/`remove` pass the pin.
  - Existing tests that call `hasQueued` are adapted mechanically (list them in Deviations);
    the new cases (the two scenarios of finding 1, and the device S→T→S one) are the tester's.
- Finding 2 (Low): add the `zkteco: sincronización omitida` warn to the runbook log table
  (`docs/integraciones/zkteco-senseface-2a.md`).
- Finding 3 (Low): accepted as is (idempotent UPDATE, longer queue only); no change.

### Re-revisión (Reviewer, 2026-10-08, tras la reparación 4d748a5 y los tests 4ad3da7)

Diff `main...HEAD`, worktree limpio. Revisé de nuevo todo lo que tocó la reparación:
`device-user-sync.ts`, `device-command.repository.ts`, `device-user-commands.ts`, el store en
memoria, `prisma-device-command.repository.ts`, el runbook y los tests nuevos.

**Checklist: 13/13 pasan.**

- [x] `pnpm plans:scope`: sale con código 1 por lo mismo que en la primera revisión. Hay un
      "fuera de alcance" más, `in-memory-device-command.repository.test.ts`, que es un test nuevo
      del tester (permitido). Los "declarados sin cambios" y los hot files siguen igual. La
      reparación tocó un test de integración del tester (`prisma-device-user.int.test.ts`): es
      la adaptación mecánica de `hasQueued` y está declarada en Deviations.
- [x] `pnpm check` en verde (api 90 archivos / 1111 passed / 5 skipped; contracts 295; arch sin
      violaciones, 314 módulos; plans, harness, hooks, bootstrap y quality en verde).
- [x] `pnpm test:integration` en verde (17 archivos / 218 tests).
- [x] Dominio: los textos y su matcher (`upsertUserPrefix`, `targetsPin`) viven juntos en
      `domain/device-user-commands.ts`. Prisma y el store en memoria los importan, así que no
      pueden separarse.
- [x] CQRS: `lastQueuedForPin` es un método del puerto de escritura que solo usa el helper de
      sincronización. No es un método para pantallas.
- [x] Contratos: la reparación no los cambia.
- [x] Errores: sin cambio.
- [x] Tiempo e ids: sin cambio (`clock`, `idGenerator`).
- [x] Esquema: la reparación no agrega migración ni la necesita.
- [x] DI: `container.test.ts` en verde.
- [x] Sin secretos ni datos reales (los RFC de prueba son sintéticos).
- [x] Deviations: comprobé la entrada de la reparación. `enqueue` recibe `{ text, pin,
employeeId }` (`device-user-sync.ts:79-83`). No queda ningún `hasQueued` en `apps/` ni en
      `docs/`.
- [x] Docs: la tabla de logs del runbook tiene la fila `zkteco: sincronización omitida`. Su
      "Cuándo" coincide con `sync-device.command.ts:46-50`, porque el caso sin redes usa su
      propio mensaje. En la sección de sincronización del runbook no queda ningún texto con la
      regla vieja.

**Hallazgos de la primera revisión**

1. Medium, **resuelto.** `device-user-sync.ts:87` marca `'duplicate'` solo si
   `lastQueuedForPin(device.id, pin) === text`. Prisma ordena `queuedAt desc, id desc`
   (`prisma-device-command.repository.ts:60`), el orden exactamente inverso a la entrega
   `nextQueued` (`:24`, `queuedAt asc, id asc`). El store en memoria hace lo mismo (`:57-69`
   contra `:83-85`). Repasé los dos escenarios con la regla nueva:
   - Caso B: el último comando es el DELETE, distinto del UPDATE, así que se encola el UPDATE
     final.
   - Caso A: el último comando es el UPDATE, distinto del DELETE, así que se encola el DELETE
     final y no queda fila.
   - El checador S→T→S sigue el mismo camino por `remove`/`push` de `SyncDevice`.

   Los tres tienen test (`sync-employee.command.test.ts` casos A y B; `sync-device.command.test.ts`
   cambio de sede del checador). El matcher no confunde un PIN que es prefijo de otro, porque el
   UPDATE exige el tab después del PIN y el DELETE exige el texto exacto. Esto está probado en
   dominio, en memoria y en Prisma.

2. Low, **resuelto** (fila en el runbook).
3. Low, **aceptado por el usuario** (decisión 21 / Repair). La regla nueva no lo cambia.

**Regresiones: ninguna.**

**Nuevos (Low, no bloquean, sin cambio de código)**

4. Incierto, teórico. `UuidV7Generator` (`apps/api/src/infrastructure/system/uuid-v7-generator.ts:10-17`)
   no es monótono dentro del mismo milisegundo. Supongamos que se encolan dos comandos opuestos
   del mismo equipo y PIN con el mismo `queuedAt`. Entonces el desempate por `id` puede entregar
   primero el más nuevo, y el registro (que refleja la última intención) quedaría opuesto al
   equipo. `lastQueuedForPin` sí es coherente con la entrega, así que la regla de la decisión 21
   se cumple. Para que pase, dos sincronizaciones del mismo PIN tendrían que terminar en menos
   de 1 ms, y cada una hace varias consultas a la BD (`findPlacement`, `listByEmployee`,
   `lastQueuedForPin`, `nextNumber`). No lo reproduje. El desempate es de la entrega del
   plan 006, no de esta reparación; lo dejo anotado sin hallazgo en `plans/hallazgos/` porque
   no veo un camino alcanzable.

Status: `verify`. No queda ningún hallazgo que pida cambio de código. El criterio 8 (equipo
real, DELETE sin confirmar) le toca al verificador.

## Verification

**PASS on criteria 1–4 and 6 live; 5 and 7 by tests only; 8 NOT VERIFIED (real device)** —
2026-10-08, main session (inline, as the user asked), at `75cb1ca` (includes the review repair
`4d748a5`). Plan stays in `verify`.

- Suites at `75cb1ca`: `pnpm check` green — `Tasks: 19 successful, 19 total`, api `1111 passed |
5 skipped`, `no dependency violations found (314 modules, 1365 dependencies cruised)`, plans lint
  OK. `pnpm test:integration`: `Test Files 17 passed`, `Tests 218 passed`.
- Migration: `pnpm --filter @rrhh/api db:deploy` → `14 migrations found … No pending migrations to
apply` (`20261008204154_create_device_users` already on the dev DB).
- Live run: a script (scratchpad, not in the repo) created a synthetic HOLDING_ADMIN and an HR user
  through the use cases (as `prisma/seed.ts` does) and drove everything else over HTTP against the
  API on `:3000` (the user's own `tsx watch` dev server on this branch; run tag `PDCK`): sedes S/T,
  colaboradores with synthetic CURP/RFC, devices D1/D2 (S) and D3 (T). **15/15 PASS**:
  - [x] C1: D1 registered in S → 0 commands. `PUT …/networks ["127.0.0.1"]` → 204 and 2 `QUEUED`
        UPDATE (A, B) with `queuedBy: null`. Replacing with `["127.0.0.1","10.0.0.0/8"]` → still 2.
  - [x] C2: `POST …/sync` → 200 `{"queued":0,"removed":0,"skipped":[]}` (A and B already last in
        queue, decision 21); repeated → still 2 commands. HR → 403. Unknown id → 404
        `DEVICE_NOT_FOUND`. D2 without networks → 422 `DEVICE_NETWORK_UNRESTRICTED`, 0 commands.
  - [x] C3: hiring D (`José Peña`) in S → UPDATE only on D1; D2 has 0 commands and 0
        `device_users` rows. The command text carries `Name=José Peña`. `PUT …/networks` on D2 →
        UPDATE for A, B and D.
  - [x] C4: `PUT …/employees/D/site` to T → 204; last command for D's PIN is DELETE on D1 and D2,
        UPDATE on D3. `PUT …/rfc` with a new RFC → 204; on D3 DELETE of the old PIN, then UPDATE of
        the new one.
  - [x] C6: a manual command for PIN `1` on D1 (not in `device_users`), then `PUT …/devices/D1/site`
        to T → 204; the new commands are UPDATE D (new RFC), DELETE A, DELETE B, and nothing for
        PIN `1`.
  - C5 (synthetic `EMPLOYEE_TERMINATED`): no producer in the running app, as the plan says; covered
    by the application/http tests only.
  - C7 and the C3 warn (`zkteco: checador sin redes, sincronización omitida`): **not observed
    live**. The API that served the run writes to the user's terminal, which this session cannot
    read, and a second instance on another port could not be started (the Bash hook blocks env
    prefixes and wrapper scripts). Covered by the http/application tests (`Test coverage`).
  - [ ] C8 **NOT VERIFIED**: needs the physical SenseFace 2A (users appear with their RFC, accented
        name on screen, DELETE removes the user and ends `DONE`, users "1" and "2" stay;
        `DATA DELETE USERINFO` is still unconfirmed on the device). For the user.
- Synthetic rows left in the dev DB (as in earlier verifications): users
  `verif007-admin-pdck@example.com` / `verif007-hr-pdck@example.com`, sedes `Verif 007 S|T PDCK`,
  colaboradores `verif007-*-pdck@example.com` (Alba Uno, Beto Dos, José Peña), devices
  `VERIF007PDCKD1|D2|D3` and their `QUEUED` commands and `device_users` rows. The devices never
  poll, so nothing is delivered.
