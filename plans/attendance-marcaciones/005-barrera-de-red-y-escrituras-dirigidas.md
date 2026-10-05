---
status: testing
module: attendance
min_implementer: mid
depends_on: ['004']
---

# 005 — Network barrier for /iclock and targeted device writes

## Context

**What exists today:**

- The serial number (`SN`) is the device's only credential: a request is served if the SN is
  registered and active (`docs/adr/0013-registro-de-equipos-en-base-de-datos.md:19-21`), checked
  in `RecordDeviceContact` (`apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts:47-51`,
  `findBySerialNumber` + `active`) and in `RecordDevicePush`
  (`record-device-push.command.ts:52-56`). ADR 0013 already flags the risk
  (`0013-…md:42-44`: outside a controlled network an extra barrier is needed).
- Since plan 004, `GET /iclock/getrequest` returns the queued command text, which carries the
  colaborador's RFC and name (`http/zkteco-adms.router.ts:87-93`;
  `application/commands/take-device-command.command.ts:20-30`). Review M1 of 004
  (`plans/attendance-marcaciones/004-sonda-de-comandos-adms.md:246-260`): anyone who knows the SN
  (printed on the device label) can poll first, receive the RFC + name, and leave the command
  `SENT`, so the real device never gets it.
- The API does not configure Express `trust proxy` (`apps/api/src/http/app.ts:19-24`), so
  `req.ip` is the TCP peer. Behind a reverse proxy in production it would be the proxy's IP.
  `req.ip` is already used for the session client info (`apps/api/src/http/bind-route.ts:52`).
- Finding `plans/hallazgos/attendance-escritura-completa-del-equipo.md`: `PrismaDeviceRepository.save`
  upserts the whole row (`infrastructure/prisma-device.repository.ts:27-34`, mapper
  `infrastructure/attendance.mapper.ts:33-46`). `RecordDevicePush` loads the device at the start
  of a (possibly long) history upload and saves it at the end (`record-device-push.command.ts:52`,
  `:112-113`), `RecordDeviceContact` does the same (`record-device-contact.command.ts:54`), so an
  admin's `PUT …/devices/:id/site` (`assign-device-site.command.ts:27-36`) landing in between is
  silently overwritten with the old `siteId`/`timeZone`.
- Arch rule `domain-no-node-builtins` (`apps/api/.dependency-cruiser.cjs:23-27`) forbids
  `node:net` in `domain/`.

**Approach.** Per README decisions 11–13: each device gets a list of allowed IPv4 networks
(addresses or CIDR), checked by the device use cases against the request's source IP; a request
from outside the list gets the same `403 ERROR: dispositivo no autorizado` (no hint) plus a warn
log. A device with an empty list keeps receiving marcaciones (nothing breaks at deploy time) but
**never gets commands**: queuing is refused and pending ones are not delivered. A new
`TRUST_PROXY` env var feeds Express `trust proxy` so `req.ip` is the device's IP behind a proxy;
unset keeps today's behavior. The device's last source IP is stored and shown so the admin can
learn which IP to allow. For the finding: the repository's whole-row `save` is replaced by
targeted writes — device-written fields (`lastSeenAt`, `lastSeenIp`, clock offset) and
admin-written fields (site + zone, networks) never touch each other's columns.

Alternatives considered: network-only barrier (firewall/VPN, no code) — rejected by the user
(decision 11), the topology is not decided yet and the app must protect itself regardless;
optimistic version column for the race — needs retry handling in the 10 s poll path for a
problem that targeted updates remove entirely; CIDR matching with `node:net.BlockList` behind a
port — IPv6 is not needed (decision 13) and a pure IPv4 value object keeps it in `domain/`.

Imitated files: route + 204 use case follow `assignDeviceSite`
(`packages/contracts/src/attendance/device.contract.ts:93-110`,
`application/commands/assign-device-site.command.ts`); error class follows `InactiveSiteError`
(`domain/errors.ts:11-17`) and its registry entry follows `DEVICE_NOT_ALLOWED`
(`packages/contracts/src/errors.ts:292-300`).

**Known limitation (documented, not fixed):** a push that started before a site change converts
its own punches with the zone it loaded; only the requests after the change use the new zone.
The runbook keeps advising to assign the site before connecting the device.

## Out of scope

- The colaborador sync, atomic take of the next command (review L2 of 004) and several results
  per `devicecmd` body (L3) — plan 006.
- IPv6 networks (decision 13). An IPv6 source on a restricted device is rejected.
- TLS/HTTPS on `/iclock`, VPN or firewall setup, choosing the production topology.
- Rate limiting of `/iclock`, alerts beyond log lines, web/mobile screens.
- Changing the identity login throttle; it only benefits from `TRUST_PROXY` (same `req.ip`).
- Purging or expiring commands already queued for unrestricted devices (they stay `QUEUED`).

## Dependencies

- `004` (same initiative, done) — `DeviceCommand`, `DeviceCommandRepository.nextQueued`,
  `QueueDeviceCommand`, `TakeDeviceCommand`, the `queueDeviceCommand` route and the
  `getrequest` delivery in `zkteco-adms.router.ts:87-93`.

## Steps

1. **Contract**
   - Files: `packages/contracts/src/attendance/device.contract.ts` (modify), `packages/contracts/src/attendance/device-command.contract.ts` (modify), `packages/contracts/src/errors.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do: in `DeviceSchema` add `allowedNetworks: z.array(z.string()).describe('Redes IPv4 (IP o CIDR) desde las que el checador puede conectarse; vacía = sin restricción de red y sin comandos')`
     and `lastSeenIp: z.string().nullable().describe('IP de origen del último contacto; null si nunca')`.
     New `SetDeviceNetworksSchema` (`.meta({ id: 'SetAttendanceDeviceNetworksInput' })`):
     `{ allowedNetworks: z.array(z.union([z.ipv4(), z.cidrv4()])).max(10) }` (empty array allowed:
     it removes the restriction). Route `setDeviceNetworks`: `PUT
/attendance/devices/:deviceId/networks`, `requires('attendance.devices:manage')`, params like
     `assignDeviceSite`, 204, `errors: ['DEVICE_NOT_FOUND']`, Spanish summary/description in the
     same shape as `assignDeviceSite` (who can, what it needs, that an empty list stops command
     delivery). In `errors.ts` add `DEVICE_NETWORK_UNRESTRICTED` (status 422, description
     `'El checador no tiene redes permitidas: no puede recibir comandos.'`, example with
     `details: { deviceId: DEVICE_ID }`) next to `DEVICE_NOT_ALLOWED`; add it to
     `queueDeviceCommand.errors` (`device-command.contract.ts:59`). Regenerate `openapi.json`;
     operation count +1 in `openapi.test.ts`.
   - Observable result: `pnpm --filter @rrhh/contracts test` passes.

2. **Domain**
   - Files: `apps/api/src/modules/attendance/domain/ipv4-network.ts` (create), `apps/api/src/modules/attendance/domain/device.ts` (modify), `apps/api/src/modules/attendance/domain/errors.ts` (modify)
   - Do: `ipv4-network.ts`: `parseIpv4Network(text): Ipv4Network | null` (accepts `a.b.c.d` or
     `a.b.c.d/n`, 0 ≤ n ≤ 32, octets 0–255 without leading-zero ambiguity; plain address = `/32`),
     `parseIpv4Address(text): number | null` that also unwraps the IPv4-mapped form
     `::ffff:a.b.c.d` (what Node reports on dual-stack sockets), and `ipv4NetworkContains(network,
address)`. Pure arithmetic on unsigned 32-bit ints, docblock explaining why there is no
     `node:net` (arch rule). `Device`: props gain `allowedNetworks: readonly string[]` and
     `lastSeenIp: string | null` (`register` sets `[]` and `null`); getters; `setAllowedNetworks(networks)`
     returns `Result<void, InvalidValueError>` (each must parse, max 10, de-duplicated, stored in
     canonical `a.b.c.d/n` text); `acceptsAddress(ip: string | null): boolean` (empty list →
     `true`; otherwise the IP must parse and fall in some network); `get receivesCommands()` =
     list not empty. `markSeen(now, ip)` also records `lastSeenIp` and returns `true` when the
     resolution elapsed **or** the IP changed. New `DeviceNetworkUnrestrictedError extends
BusinessRuleViolationError` (`code = 'DEVICE_NETWORK_UNRESTRICTED'`, message
     `'El checador no tiene redes permitidas: no puede recibir comandos'`, details `{ deviceId }`).
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes (callers fixed in step 4).

3. **Repository: targeted writes + persistence**
   - Files: `apps/api/src/modules/attendance/domain/device.repository.ts` (modify), `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261005165911_add_device_networks/migration.sql` (create), `apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts` (modify), `apps/api/src/modules/attendance/infrastructure/attendance.mapper.ts` (modify), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-attendance.store.ts` (modify), `apps/api/src/modules/attendance/infrastructure/prisma-attendance.queries.ts` (modify)
   - Do: replace `save` in `DeviceRepository` with four methods, each with a docblock naming who
     writes those columns: `add(device)` (insert; unique violation →
     `DeviceAlreadyRegisteredError`, as today's catch at `prisma-device.repository.ts:37-40`);
     `saveContact(device)` (only `lastSeenAt`, `lastSeenIp`, `clockOffsetSeconds`,
     `clockOffsetMeasuredAt`); `saveSite(device)` (only `siteId`, `timeZone`);
     `saveAllowedNetworks(device)` (only `allowedNetworks`). The three `save*` return
     `Promise<void>` and use Prisma `update({ where: { id }, data: { …only those fields } })`.
     Schema `AttendanceDevice`: `allowedNetworks String[] @default([]) @map("allowed_networks")`,
     `lastSeenIp String? @map("last_seen_ip") @db.VarChar(45)`. `pnpm db:migrate --name
add_device_networks`; the generated SQL must be only the two `ALTER TABLE … ADD COLUMN`
     (existing devices get `{}` = unrestricted, decision 12); record the real folder name in
     Deviations. Mapper `toDomain`/`toPersistence` carry the two fields (`toPersistence` is now
     used only by `add`). In-memory repository: the same four methods; since the store keeps the
     instance, each `save*` copies only its fields onto the stored device (via the domain's
     `restore` with merged props) so in-memory semantics match Prisma. `listDevices` maps
     `allowedNetworks` and `lastSeenIp` (`prisma-attendance.queries.ts:26-41`); same in
     `InMemoryAttendanceQueries`.
   - Observable result: migration applied on dev and test DBs; `pnpm --filter @rrhh/api typecheck`
     passes once step 4 is done.

4. **Application**
   - Files: `apps/api/src/modules/attendance/application/commands/register-device.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/set-device-networks.command.ts` (create), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.ts` (modify), `apps/api/src/modules/attendance/application/commands/take-device-command.command.ts` (modify)
   - Do: `RegisterDevice` → `add`. `AssignDeviceSite` → `saveSite`. `RecordDeviceContact` and
     `RecordDevicePush`: input gains `sourceIp: string | null`; after the `active` check, if
     `!device.acceptsAddress(sourceIp)` log warn `'zkteco: IP no permitida'` with
     `{ serialNumber, sourceIp, …contact or table }` and return `DeviceNotAllowedError` (same
     outward error as an unregistered SN); `markSeen(now, sourceIp)`; persist with `saveContact`
     (push: when `seen || offsetRecorded`, as today at `record-device-push.command.ts:112-113`).
     New `SetDeviceNetworks` (deps `deviceRepository`, `logger`; input `{ deviceId,
allowedNetworks }`): `DeviceNotFoundError`, `setAllowedNetworks`, `saveAllowedNetworks`, log
     info `'zkteco: redes del equipo actualizadas'` `{ serialNumber, allowedNetworks }`.
     `QueueDeviceCommand`: after loading the device, `!device.receivesCommands` →
     `DeviceNetworkUnrestrictedError` (nothing queued). `TakeDeviceCommand`: deps gain
     `deviceRepository`; load by id, return `null` (command stays `QUEUED`) when the device is
     missing or `!receivesCommands`.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes.

5. **HTTP, trust proxy, module**
   - Files: `apps/api/src/config/env.ts` (modify), `apps/api/.env.example` (modify), `apps/api/src/http/app.ts` (modify), `apps/api/src/modules/attendance/http/zkteco-adms.router.ts` (modify), `apps/api/src/modules/attendance/http/attendance.router.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify)
   - Do: env `TRUST_PROXY`: optional; `''`/absent → `false`; an integer → that number of hops;
     otherwise a comma-separated list of IPs/CIDRs (trimmed) passed to Express as an array.
     Comment: why (the barrier and the login throttle read `req.ip`) and that a wrong value lets
     a client spoof `X-Forwarded-For`. `.env.example`: `TRUST_PROXY=` with a one-line Spanish
     comment. `app.ts`: `app.set('trust proxy', env.TRUST_PROXY)` right after
     `disable('x-powered-by')`. ADMS router: pass `sourceIp: req.ip ?? null` to both use cases
     (`contact` helper `:44-52` and `cdata` POST `:70-78`). `attendance.router.ts`: bind
     `setDeviceNetworks` like `assignDeviceSite` (`:37-38`). Module: register `setDeviceNetworks`.
   - Observable result: `pnpm check` passes.

6. **Docs**
   - Files: `docs/adr/0014-barrera-de-red-por-checador.md` (create), `docs/adr/README.md` (modify), `docs/integraciones/zkteco-senseface-2a.md` (modify), `plans/hallazgos/attendance-escritura-completa-del-equipo.md` (modify)
   - Do: ADR 0014 (Spanish, `0000-plantilla.md` shape, Aceptado, 2026-10-05): complements 0013 —
     allowed IPv4 networks per device, empty list = marcaciones yes / commands no, `TRUST_PROXY`,
     IPv6 excluded, the SN stays a weak credential (spoofable IP only from inside the allowed
     network); alternatives = network-only, accept the risk. Row in the ADR index. Runbook: a
     section "Redes permitidas" (how to read `lastSeenIp` in `GET /attendance/devices`, set it
     with `PUT …/networks`, that commands require it, `TRUST_PROXY` behind a proxy, sedes with
     a dynamic IP need a range or a fixed IP), the `zkteco: IP no permitida` line in the log
     table, and the in-flight push limitation from Context. Finding → `status: resolved`,
     `plan: attendance-marcaciones/005`, a "Resolución" paragraph.
   - Observable result: `pnpm check` passes (plans lint included).

7. **Existing tests adapted to the new signatures** (declared by the implementer, deviation 2)
   - Files: `packages/contracts/src/attendance/device.contract.test.ts` (modify), `apps/api/src/modules/attendance/domain/device.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/assign-device-site.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/queue-device-command.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-contact.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/record-device-push.command.test.ts` (modify), `apps/api/src/modules/attendance/application/commands/take-device-command.command.test.ts` (modify), `apps/api/tests/attendance-device-commands.test.ts` (modify), `apps/api/tests/attendance.test.ts` (modify), `apps/api/tests/request-logging-and-body-errors.test.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-attendance.int.test.ts` (modify), `apps/api/tests/integration/attendance/prisma-device-command.int.test.ts` (modify)
   - Do: mechanical only — `save` → `add`/`saveContact`/`saveSite`, the two new `DeviceProps`,
     `markSeen(now, null)`, `sourceIp: null` in inputs and expected logs, and devices with networks
     in the command fixtures. No new behavior tested here (that is the tester's phase).
   - Observable result: the pre-existing suites stay green.

## Acceptance criteria

- [ ] `GET /api/v1/attendance/devices` shows `allowedNetworks: []` and `lastSeenIp` (the IP of
      the last `/iclock` request) for an existing device after migration.
- [ ] `PUT …/devices/:id/networks` `{"allowedNetworks":["127.0.0.1"]}` → 204 as HOLDING_ADMIN;
      403 as HR; 404 `DEVICE_NOT_FOUND` for an unknown id; 400 for `"10.0.0.0/33"` or an IPv6
      value; the list reads back in canonical form (`127.0.0.1/32`).
- [ ] With a list that excludes the caller (e.g. `["10.9.9.0/24"]`), `GET /iclock/cdata`,
      `GET /iclock/getrequest` and `POST /iclock/cdata?table=ATTLOG` answer
      `403 ERROR: dispositivo no autorizado`, no punch is stored, and the log shows
      `zkteco: IP no permitida` with the serial and source IP. With a list that includes it, all
      three work as before.
- [ ] Device with an empty list: ATTLOG still stored; `POST …/commands` → 422
      `DEVICE_NETWORK_UNRESTRICTED`; a command queued while it had networks, after the list is
      emptied, is NOT returned by `getrequest` and stays `QUEUED`.
- [ ] Race of the finding: with the device's row loaded by a push in flight, a `PUT …/site`
      that lands before the push saves survives (integration test; site and zone unchanged
      after the push's `saveContact`).
- [ ] `TRUST_PROXY=1` and a request with `X-Forwarded-For: 10.9.9.5` is evaluated as
      `10.9.9.5`; unset, the header is ignored.
- [ ] Real device (user): after setting its LAN/public IP from `lastSeenIp`, it keeps sending
      marcaciones and receives a queued `USERINFO` command.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                              |
| ----------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| domain      | yes     | `ipv4-network` parsing/containment/edges (`/0`, `/32`, mapped IPv6, junk); `Device` networks, `acceptsAddress`, `receivesCommands`, `markSeen` with IP change      |
| application | yes     | contact/push reject by IP; `SetDeviceNetworks`; queue refused when unrestricted; take returns null when unrestricted; each use case calls the right targeted write |
| contract    | yes     | `SetDeviceNetworksSchema` accepts/rejects; `DeviceSchema` new fields; error registry                                                                               |
| http        | yes     | `/networks` route statuses; `/iclock` 403 by IP via supertest; `TRUST_PROXY` env parsing (`env.test.ts`)                                                           |
| integration | yes     | migration columns/defaults; each `save*` writes only its columns (stale-instance race)                                                                             |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                        |

## Deviations

Implemented inline by the main session on 2026-10-05 (the user approved the plan in chat:
"implementalo"). `pnpm check` green (api 838 passed / 5 skipped, contracts 260);
`pnpm test:integration` 15 files / 178 tests green; migration applied on dev and test DBs.

1. **Migration name** (cosmetic). The plan had a `<timestamp>` placeholder; the real folder is
   `20261005165911_add_device_networks`, written into the step 3 `Files:` line. The SQL is only
   the two `ADD COLUMN` (Prisma emits `allowed_networks TEXT[] DEFAULT ARRAY[]::TEXT[]`, nullable
   at the DB level as Prisma does for scalar lists; the client always writes an array).
   `prisma format` also realigned the whitespace of the `AttendanceDevice` block.
2. **Existing tests had to change** (scope; mechanical, no design impact). The plan did not list
   the test files that call `DeviceRepository.save`, build `DeviceProps`, call `markSeen(now)` or
   build use-case inputs without `sourceIp`, nor the command fixtures that now need networks
   (decision 12). They were adapted mechanically and declared in the new step 7. No new
   behavior was tested: that remains the tester's phase.
3. **Prisma client regeneration** (cosmetic). `pnpm db:migrate` did not regenerate the client;
   ran `pnpm db:generate` (generated code, not versioned).
4. **`sourceIp` in the contact log** (small addition, not in the plan's text). The info/debug log
   `zkteco: contacto del dispositivo` and both `dispositivo no autorizado` warns now carry
   `sourceIp`, so the admin can see where a device connects from (the plan only asked for it in
   `IP no permitida`). The IP of a device is not personal data.
5. **In-memory device repository returns copies** (plan step 3 said "copies only its fields onto
   the stored device"). To match Prisma, `findById`/`findBySerialNumber` also return copies, so a
   stale instance cannot mutate the stored one; `add` rejects a repeated id as well as a repeated
   serial. `saveContact`/`saveSite`/`saveAllowedNetworks` on a missing id reject the promise
   (as Prisma's `update` does).
6. **`DeviceRepository.add` returns `Result`; the three `save*` return `Promise<void>`** as the plan
   said, so `AssignDeviceSite` no longer propagates a save error (it could only be a serial
   conflict, impossible when the serial does not change).

## Test coverage

## Review findings

## Verification
