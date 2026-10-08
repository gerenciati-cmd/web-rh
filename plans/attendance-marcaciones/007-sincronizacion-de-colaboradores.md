---
status: review
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
- Step 4: `SyncEmployee` se partió en `findTarget`, `removeStale` y `addMissing` solo para bajar la complejidad ciclomática; sin cambio de comportamiento.

## Test coverage

Tester, 2026-10-08. Baseline `pnpm check` verde (api 1026 passed | 5 skipped). Cierre: `pnpm check` verde (api 1096 passed | 5 skipped; contracts +7) y `pnpm test:integration` verde (214 passed, 17 archivos; baseline del plan 199). Sin GAP ni NOT CONFIRMED: todo lo que promete el plan está implementado y se ejerció. Los fixtures de los pasos 1-8 (nullable `queuedBy`, `now` en `assignSite`/`setAllowedNetworks`, fakes) los dejó el implementer; aquí solo hay casos nuevos.

| Comportamiento (plan / código)                                                                                                                                    | Capa        | Test                                                                                                                         | Estado                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| UPDATE confirmado (texto exacto), nombre saneado (`\p{Cc}`, espacios), DELETE por PIN                                                                             | domain      | `domain/device-user-commands.test.ts`                                                                                        | CONFIRMED                                      |
| `assignSite` registra `DEVICE_SITE_ASSIGNED` solo si cambia la sede; la zona se copia siempre                                                                     | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `setAllowedNetworks` registra `DEVICE_COMMANDS_ENABLED` solo en vacío→no vacío (otra vez al rehabilitar)                                                          | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `DeviceCommand.queue` acepta `queuedBy: null`; `DeviceWithoutSiteError`                                                                                           | domain      | `domain/device-sync-events.test.ts`                                                                                          | CONFIRMED                                      |
| `AssignDeviceSite` / `SetDeviceNetworks` publican los eventos (y nada si no hay cambio o es inválido)                                                             | application | `application/commands/device-sync-triggers.test.ts`                                                                          | CONFIRMED                                      |
| Compuerta de la barrera en `push`/`remove` (sin cola ni registro), duplicado, invalid, `queued`                                                                   | application | `application/device-user-sync.test.ts`                                                                                       | CONFIRMED                                      |
| `SyncDevice`: altas, NO_RFC, sin duplicar, bajas, no toca PIN ajenos, 404/422 sede/422 redes, inactivo, `queuedBy` null + warn, logs sin RFC/nombre, texto >500   | application | `application/commands/sync-device.command.test.ts`                                                                           | CONFIRMED                                      |
| `SyncEmployee`: alta, idempotencia, equipos inactivos, cambio de sede/RFC, baja, sin RFC/sede, equipo sin redes omitido (alta y baja) con un warn, equipo borrado | application | `application/commands/sync-employee.command.test.ts`                                                                         | CONFIRMED                                      |
| Repositorio en memoria de `device_users` (mismo contrato que Prisma)                                                                                              | application | `infrastructure/in-memory/in-memory-device-user.repository.test.ts`                                                          | CONFIRMED                                      |
| `DeviceSyncResultSchema`, ruta `syncDevice` (POST, permiso, errores), `DEVICE_WITHOUT_SITE` en el catálogo                                                        | contract    | `packages/contracts/src/attendance/device-sync.contract.test.ts` (+ `queuedBy` null ya en `device-command.contract.test.ts`) | CONFIRMED                                      |
| Criterio 1: registrar no encola; poner redes encola A y B (no C sin RFC, `queuedBy` null); cambiar redes no repite                                                | http        | `tests/attendance-device-sync.test.ts › criterio 1`                                                                          | CONFIRMED                                      |
| Criterio 2: 200 + NO_RFC sin duplicar; encola faltantes y da de baja; HR 403, 401, 404, 400, 422 sin sede, 422 sin redes                                          | http        | `tests/attendance-device-sync.test.ts › criterio 2`                                                                          | CONFIRMED                                      |
| Criterio 3: equipo con redes y otro sin; warn con `deviceId`; sin fila en el registro; al habilitarlo recibe a la sede                                            | http        | `tests/attendance-device-sync.test.ts › criterio 3`                                                                          | CONFIRMED                                      |
| Criterio 4: alta, `PUT …/site`, `PUT …/rfc`                                                                                                                       | http        | `tests/attendance-device-sync.test.ts › criterio 4`                                                                          | CONFIRMED                                      |
| Criterio 5: `EMPLOYEE_TERMINATED` sintético → DELETE                                                                                                              | http        | `tests/attendance-device-sync.test.ts › criterio 5`                                                                          | CONFIRMED                                      |
| Criterio 6: `PUT …/devices/:id/site` → DELETE de la sede vieja, UPDATE de la nueva; registro queda con la nueva                                                   | http        | `tests/attendance-device-sync.test.ts › criterio 6`                                                                          | CONFIRMED                                      |
| Criterio 7: ningún log de la sincronización lleva RFC ni nombre                                                                                                   | http        | `tests/attendance-device-sync.test.ts › criterio 7`                                                                          | CONFIRMED                                      |
| Payload malformado en las suscripciones no rompe al publicador ni encola                                                                                          | http        | `tests/attendance-device-sync.test.ts › suscripciones`                                                                       | CONFIRMED                                      |
| OpenAPI documenta el POST de sync con `attendance.devices:manage`                                                                                                 | http        | `tests/attendance-device-sync.test.ts › OpenAPI`                                                                             | CONFIRMED                                      |
| Migración: columnas de `device_users`, `queued_by` nullable, sin FK a employees (ADR 0010)                                                                        | integration | `tests/integration/attendance/prisma-device-user.int.test.ts › migración`                                                    | CONFIRMED                                      |
| `put` upsert, `listByDevice`/`listByEmployee`, `remove` idempotente, FK a devices                                                                                 | integration | `prisma-device-user.int.test.ts › PrismaDeviceUserRepository`                                                                | CONFIRMED                                      |
| `listActiveBySite` (solo activos, orden por nombre); `hasQueued`; `queuedBy` null persiste                                                                        | integration | `prisma-device-user.int.test.ts › listActiveBySite / hasQueued`                                                              | CONFIRMED                                      |
| Criterio 8: dispositivo real (usuarios aparecen, acentos, DELETE termina `DONE`, usuarios "1" y "2" intactos)                                                     | e2e/real    | no aplica a tests automatizados                                                                                              | NOT VERIFIED (verificador, necesita el equipo) |

Notas: (1) el texto del DELETE sigue sin confirmarse en el equipo; los tests fijan el texto del plan, no su efecto. (2) La bitácora (`GET …/commands`) no garantiza orden cronológico estable entre comandos del mismo instante: los tests http comparan por conjunto/ordenado. (3) Pase de cierre: el primer `pnpm check` falló por lint en mis tests (`no-unsafe-return`, `import-x/order`); se corrigió y el segundo pasó, así que fueron tres corridas completas de `check` en vez de dos.

## Review findings

## Verification
