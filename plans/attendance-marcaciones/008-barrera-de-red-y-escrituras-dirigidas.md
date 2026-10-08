---
status: verify
module: attendance
min_implementer: mid
depends_on: ['004']
---

# 008 — Network barrier for /iclock and targeted device writes

> **Renumbered 2026-10-08.** Written, implemented and verified as plan 005 on a branch parallel to
> plans 005–007 of this series; renumbered when both lines were integrated (README, "Two parallel
> lines"). The text below is kept as recorded: "plan 005" means this plan, "plan 006" means the
> sync (now 007), "ADR 0014" means ADR 0015, and "decisions 11–13" mean README decisions 15–17.
> In the integrated code the atomic take of plan 006 runs after this plan's network check.

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

8. **Test files of this plan** (declared by the main session after the tester phase)
   - Files: `apps/api/src/modules/attendance/domain/ipv4-network.test.ts` (create), `apps/api/src/modules/attendance/domain/device-networks.test.ts` (create), `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts` (create), `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-device.repository.test.ts` (create), `apps/api/src/config/env-trust-proxy.test.ts` (create), `apps/api/tests/attendance-device-network.test.ts` (create), `apps/api/tests/integration/attendance/prisma-device-networks.int.test.ts` (create), `packages/contracts/src/attendance/device-networks.contract.test.ts` (create)
   - Observable result: `pnpm check` and `pnpm test:integration` green.

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

Tester, 2026-10-05. Baseline (`pnpm check` + `pnpm test:integration`): green, api 838 passed / 5
skipped, integration 15 files / 178 tests. Closing: `pnpm check` green (api 971 passed / 1 expected
fail / 5 skipped; contracts 283), `pnpm test:integration` 16 files / 189 tests. New files only (the
step-7 files were not touched):

- `apps/api/src/modules/attendance/domain/ipv4-network.test.ts`
- `apps/api/src/modules/attendance/domain/device-networks.test.ts`
- `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts`
- `apps/api/src/modules/attendance/infrastructure/in-memory/in-memory-device.repository.test.ts`
- `packages/contracts/src/attendance/device-networks.contract.test.ts`
- `apps/api/src/config/env-trust-proxy.test.ts`
- `apps/api/tests/attendance-device-network.test.ts`
- `apps/api/tests/integration/attendance/prisma-device-networks.int.test.ts`

| Behavior (plan / code)                                                                                                                               | Source                                                                             | Layer                 | Test                                                                                | State                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| IPv4 parsing: octets, no leading zeros, `/n` 0-32, junk and IPv6 rejected, mapped form unwrapped                                                     | `ipv4-network.ts:19-40`                                                            | domain                | `ipv4-network.test.ts › parseIpv4Address / parseIpv4Network`                        | CONFIRMED                                                          |
| Containment (`/0`, `/31`, `/32`, `/24` edges, high range) and canonical text                                                                         | `ipv4-network.ts:42-61`                                                            | domain                | `ipv4-network.test.ts › ipv4NetworkContains / formatIpv4Network`                    | CONFIRMED                                                          |
| `setAllowedNetworks`: canonical, de-dup, empty, invalid keeps previous, max 10 distinct                                                              | `device.ts:setAllowedNetworks`                                                     | domain                | `device-networks.test.ts › Device.setAllowedNetworks`                               | CONFIRMED                                                          |
| `acceptsAddress` (empty = any, null/junk/IPv6 rejected when restricted, mapped accepted); `receivesCommands`                                         | `device.ts:acceptsAddress`, `receivesCommands`                                     | domain                | `device-networks.test.ts › acceptsAddress / receivesCommands`                       | CONFIRMED                                                          |
| `markSeen(now, ip)` persists on first contact, resolution elapsed or IP change                                                                       | `device.ts:markSeen`                                                               | domain                | `device-networks.test.ts › Device.markSeen con IP`                                  | CONFIRMED                                                          |
| `DeviceNetworkUnrestrictedError` code/message/details                                                                                                | `errors.ts:DeviceNetworkUnrestrictedError`                                         | domain                | `device-networks.test.ts › DeviceNetworkUnrestrictedError`                          | CONFIRMED                                                          |
| Contact rejected by IP: same outward error as unknown SN, warn `IP no permitida`, no `lastSeen` write; null IP rejected                              | `record-device-contact.command.ts:47-60`                                           | application           | `device-network-barrier.test.ts › RecordDeviceContact: barrera de red`              | CONFIRMED                                                          |
| Push rejected by IP: no punches stored, `records` getter not read, warn with table+IP; unrestricted device still stores                              | `record-device-push.command.ts:52-60`                                              | application           | `device-network-barrier.test.ts › RecordDevicePush: barrera de red`                 | CONFIRMED                                                          |
| Finding race: site change during an in-flight push survives `saveContact`                                                                            | `record-device-push.command.ts` + `saveContact`                                    | application           | `device-network-barrier.test.ts › un cambio de sede hecho mientras el envío…`       | CONFIRMED                                                          |
| `SetDeviceNetworks`: canonical save, empty list, NOT_FOUND, INVALID_VALUE (bad/too many), log, only its column                                       | `set-device-networks.command.ts`                                                   | application           | `device-network-barrier.test.ts › SetDeviceNetworks`                                | CONFIRMED                                                          |
| Queue refused when unrestricted (422 code + details, nothing queued/logged); NOT_FOUND first                                                         | `queue-device-command.command.ts:36-41`                                            | application           | `device-network-barrier.test.ts › QueueDeviceCommand: barrera de red`               | CONFIRMED                                                          |
| Take returns null when unrestricted and the command stays `QUEUED`; delivered after networks return                                                  | `take-device-command.command.ts:26-27`                                             | application           | `device-network-barrier.test.ts › TakeDeviceCommand: barrera de red`                | CONFIRMED                                                          |
| `AssignDeviceSite` writes only site+zone (contact and networks landing in between survive)                                                           | `assign-device-site.command.ts:+saveSite`                                          | application           | `device-network-barrier.test.ts › AssignDeviceSite: escritura dirigida`             | CONFIRMED                                                          |
| In-memory repo mirrors Prisma: each `save*` only its columns, copies, `add` duplicate id/serial, missing id rejects                                  | `in-memory-attendance.store.ts:InMemoryDeviceRepository`                           | application (adapter) | `in-memory-device.repository.test.ts`                                               | CONFIRMED                                                          |
| `SetDeviceNetworksSchema`: IP/CIDR accepted, `/33`, IPv6, junk, 11 items, wrong shape rejected                                                       | `device.contract.ts:65-73`                                                         | contract              | `device-networks.contract.test.ts › SetDeviceNetworksSchema`                        | CONFIRMED                                                          |
| `DeviceSchema` requires `allowedNetworks` and nullable `lastSeenIp`                                                                                  | `device.contract.ts:DeviceSchema`                                                  | contract              | `device-networks.contract.test.ts › DeviceSchema: campos de red`                    | CONFIRMED                                                          |
| Route `setDeviceNetworks` shape; error registry entry (422); `queueDeviceCommand.errors`                                                             | `device.contract.ts:127-146`, `errors.ts:303-312`, `device-command.contract.ts:59` | contract              | `device-networks.contract.test.ts › setDeviceNetworks y el registro de errores`     | CONFIRMED                                                          |
| `PUT .../networks`: 204 admin + canonical read-back, empty list, 403 HR, 401, 404, 400 (bad prefix, IPv6, junk, >10, wrong shape, non-UUID id)       | `attendance.router.ts`, contract                                                   | http                  | `attendance-device-network.test.ts › PUT /attendance/devices/:deviceId/networks`    | CONFIRMED                                                          |
| `GET /attendance/devices` shows `allowedNetworks` and `lastSeenIp` after a contact                                                                   | `prisma-attendance.queries.ts` / in-memory queries                                 | http                  | `attendance-device-network.test.ts › GET /attendance/devices…`                      | CONFIRMED                                                          |
| `/iclock` cdata, getrequest, ATTLOG answer `403 ERROR: dispositivo no autorizado` when IP excluded; no punch stored; log line; allowed IP works      | `zkteco-adms.router.ts`                                                            | http                  | `attendance-device-network.test.ts › /iclock con redes que excluyen / incluyen…`    | CONFIRMED                                                          |
| Unrestricted device: ATTLOG stored, `POST .../commands` 422 `DEVICE_NETWORK_UNRESTRICTED`, queued command not delivered after emptying               | router + use cases                                                                 | http                  | `attendance-device-network.test.ts › equipo sin redes permitidas`                   | CONFIRMED                                                          |
| `TRUST_PROXY=1` evaluates `X-Forwarded-For`; unset or empty ignores it                                                                               | `app.ts`, `env.ts:TRUST_PROXY`                                                     | http                  | `attendance-device-network.test.ts › TRUST_PROXY`                                   | CONFIRMED                                                          |
| `TRUST_PROXY` parsing: absent/blank -> false, integer -> hops, list -> trimmed array                                                                 | `env.ts:26-37`                                                                     | http (config)         | `env-trust-proxy.test.ts`                                                           | CONFIRMED                                                          |
| Migration columns (`allowed_networks` ARRAY, `last_seen_ip` varchar(45)); legacy row -> `[]`/null                                                    | `migrations/20261005165911_add_device_networks/migration.sql`                      | integration           | `prisma-device-networks.int.test.ts › migración add_device_networks`                | CONFIRMED                                                          |
| Each `save*` writes only its columns against Postgres (stale-instance races, all three pairs); `listDevices` exposes both fields; missing id rejects | `prisma-device.repository.ts:44-69`                                                | integration           | `prisma-device-networks.int.test.ts › escrituras dirigidas`                         | CONFIRMED                                                          |
| Admin can paste the IP shown in `lastSeenIp` into `PUT .../networks` (plan Approach: "so the admin can learn which IP to allow")                     | `zkteco-adms.router.ts` (`req.ip`), `device.contract.ts` (`z.ipv4()`)              | http                  | `attendance-device-network.test.ts › GAP: plan 005 — la IP mostrada en lastSeenIp…` | **GAP**                                                            |
| Real device keeps sending and receives a queued `USERINFO` after setting its IP                                                                      | acceptance criterion 7 (needs the physical checador)                               | e2e/manual            | not testable locally; belongs to verify                                             | NOT CONFIRMED (not written; no `.skip` added, covered by verifier) |

**GAP (1):** on a dual-stack socket Node reports `req.ip` as `::ffff:127.0.0.1`; that exact string is
stored in `lastSeenIp` and shown by `GET /attendance/devices` (confirmed by test), but
`PUT .../networks` validates with `z.ipv4()` and answers 400 for it. The admin cannot copy the shown
IP straight into the list, which is the flow the plan's Approach promises. The in-domain matching
already unwraps the mapped form (so the barrier itself works); the fix belongs to the product code
(normalize the mapped form before storing/showing `lastSeenIp`, or accept it in the contract). The
`it.fails` turns red when it is fixed, to be promoted to a normal `it`.

Minor: the baseline run and the closing run were the two full runs; after the closing run a single
lint warning (complexity 14 in my new `in-memory-device.repository.test.ts`) was fixed and only
that file was re-linted and re-run.

## Review findings

Reviewer, 2026-10-05. Diff base `843e5e0` (commits `650cda0`, `ceb9134`, `e42de82`), clean worktree.

**Checklist: 13/13 passed.**

- [x] `pnpm plans:scope … --base 843e5e0`: all 55 changed files in scope. (Against the default
      base `main` it lists ~140 files outside scope: they belong to the earlier unmerged plans of
      this branch, not to 005.) Hot file `schema.prisma`: the new lines are appended; the existing
      `AttendanceDevice` lines were only re-aligned by `prisma format` (whitespace, declared in
      Deviation 1).
- [x] `pnpm check` green (api 971 passed / 1 expected fail / 5 skipped, contracts 283, arch: no
      violations, plans lint, harness).
- [x] `pnpm test:integration` green (16 files / 189 tests).
- [x] Business rules in `domain/` (`ipv4-network.ts`, `Device.setAllowedNetworks/acceptsAddress/receivesCommands/markSeen`);
      router and repositories carry none.
- [x] CQRS-lite: `SetDeviceNetworks` goes aggregate → `saveAllowedNetworks` → `Result`; the
      targeted `save*` are column groups, not screen methods; `listDevices` through the queries port.
- [x] Types from `@rrhh/contracts` (`setDeviceNetworks` route, `DeviceSchema` fields).
- [x] Expected errors: `DeviceNetworkUnrestrictedError` (`DEVICE_NETWORK_UNRESTRICTED`, 422, in the
      registry and in `queueDeviceCommand.errors`).
- [x] Time via `Clock`; no money; dates unchanged.
- [x] New migration `20261005165911_add_device_networks`: only two `ADD COLUMN`, no DROP, no FK.
- [x] `setDeviceNetworks` registered once in `attendance.module.ts`; container test green.
- [x] No secrets or real personal data (`TRUST_PROXY=` empty in `.env.example`; doc IPs are private/TEST-NET).
- [x] Deviations honest. Spot-check of Deviation 5: `InMemoryDeviceRepository.add` rejects a
      repeated id or serial and `findById`/`findBySerialNumber` return copies
      (`in-memory-attendance.store.ts:58-72`) — matches.
- [x] Docs updated: ADR 0014 + index row, runbook "Redes permitidas" + log table + in-flight
      limitation, finding resolved, initiative README.

### Findings

**Medium**

- **M1 — The IP shown in `lastSeenIp` is rejected by `PUT …/networks` on a default deployment
  (confirmed; tester GAP).** `apps/api/src/modules/attendance/http/zkteco-adms.router.ts:52,79`
  pass `req.ip` raw to the use cases, and `Device.markSeen` (`domain/device.ts:214-220`) stores it
  as-is. The server listens without a host (`apps/api/src/main/http.ts:13`), so Node binds the
  dual-stack `::` socket and an IPv4 device arrives as `::ffff:192.168.1.50`. That string is what
  `GET /attendance/devices` shows, but `SetDeviceNetworksSchema`
  (`packages/contracts/src/attendance/device.contract.ts:65-73`, `z.ipv4()`/`z.cidrv4()`) answers
  400 for it. Scenario: the admin follows the runbook literally
  (`docs/integraciones/zkteco-senseface-2a.md`, "Redes permitidas" steps 1-2: read `lastSeenIp`,
  allow "esa IP") and gets 400; the acceptance criterion 7 flow (set the IP from `lastSeenIp`)
  fails the same way on the real device. The barrier itself is correct (matching unwraps the
  mapped form). Fix belongs to product code, e.g. normalize the mapped form to plain IPv4 before
  storing/showing `lastSeenIp` (the domain already has the unwrap in `parseIpv4Address`); then
  promote the `it.fails` in `apps/api/tests/attendance-device-network.test.ts:170-177` to `it`.

**Low**

- **L1 — `lastSeenIp` is not bounded before persisting into `VarChar(45)` (uncertain).**
  `record-device-contact.command.ts:61` / `record-device-push.command.ts:121` →
  `prisma-device.repository.ts:41-51` write `req.ip` unchecked. With `TRUST_PROXY` set to more
  hops than real proxies (the misconfiguration the ADR warns about), the client entry of
  `X-Forwarded-For` is caller-controlled; on a device without networks (which accepts any source)
  an overlong value would make `saveContact` throw and every `/iclock` contact of that serial answer
  500 instead of being served. Not exercised; depends on misconfiguration, and on whether Express
  exposes unparsed XFF entries with numeric trust (believed so, not verified). Possible remedy:
  store only a parsed IPv4/valid address (or null), which would also cover M1.

No High findings. No out-of-scope discoveries requiring a new `plans/hallazgos/` entry.

Status stays `review`: M1 needs a product-code change (back to implementing per the repair
handoff; repaired code repeats testing → review → verify).

### Repair (main session, 2026-10-05)

Back to `implementing` to fix **M1 and L1** with one change (in scope: same files as steps 2
and 4; no contract, schema or design change):

- `apps/api/src/modules/attendance/domain/ipv4-network.ts`: add `formatIpv4Address(address:
number): string` (dotted form) next to `formatIpv4Network`.
- `apps/api/src/modules/attendance/domain/device.ts`: `markSeen(now, ip)` stores a **normalized**
  source IP: an IPv4 or IPv4-mapped IPv6 (`::ffff:a.b.c.d`) becomes plain `a.b.c.d` (via
  `parseIpv4Address` + `formatIpv4Address`); any other value is kept only if it is at most 45
  characters and contains only hex digits, `:` and `.` (a real IPv6); otherwise `null`. The
  "IP changed" comparison uses the normalized value. Docblock: why (the shown IP must be pasteable
  into `PUT …/networks`; the column is `VarChar(45)` and the value may come from
  `X-Forwarded-For`). `acceptsAddress` is unchanged.
- No test changes by the implementer: promoting the `it.fails` GAP at
  `apps/api/tests/attendance-device-network.test.ts:170-177` and covering L1 is the tester's
  re-run. Previous Test coverage and Review findings stay as dated history.

Implemented (implementer, 2026-10-05): `formatIpv4Address` added to `ipv4-network.ts`;
`Device.markSeen` normalizes through a private `normalizeSourceIp` (IPv4/mapped -> `a.b.c.d`;
other values kept only if at most 45 chars of hex/`:`/`.` containing `:`; else `null`). No
deviations. `pnpm check` is RED by design, only on three tests that asserted the old behavior
(previous Test coverage/Review results are superseded for this code; the tester must update them):

- `apps/api/tests/attendance-device-network.test.ts:161` expects `::ffff:127.0.0.1`, now `127.0.0.1`.
- `apps/api/tests/attendance-device-network.test.ts` GAP `it.fails` (M1) now passes, so promote it to `it`.
- `apps/api/src/modules/attendance/application/commands/device-network-barrier.test.ts:170` expects
  `::ffff:10.9.9.5`, now `10.9.9.5`.
- L1 (overlong or garbage IP becomes `null`) has no test yet. Status set to `testing`.

Tester re-run (2026-10-05, after the repair), all four items resolved. The two stale expectations
now assert `127.0.0.1` / `10.9.9.5`; the GAP `it.fails` was promoted to a normal `it` (CONFIRMED,
M1 closed, no GAP remains). L1 is covered in `device-networks.test.ts` (`it.each`: mapped, plain,
IPv6 and trimmed IPv6 normalize; garbage, 3 octets, X-Forwarded-For list, over 45 chars, non-hex
and empty become `null`; change-to-null and mapped-equals-plain resolution cases) and
`ipv4-network.test.ts › formatIpv4Address` (round trip). Closing runs: `pnpm check` green (api 988
passed / 5 skipped, 0 expected fails; contracts 283; arch: no violations), `pnpm test:integration`
16 files / 189 tests. The criterion-7 NOT CONFIRMED (physical checador) stays for verify. This
supersedes the earlier GAP row and counts in "Test coverage" above.

### Review round 2 (reviewer, 2026-10-05)

Repair diff `e42de82..3c8301b` (fix `73af959`, tests `3c8301b`), clean worktree. The round-1
checklist was re-run on the full plan base `843e5e0`.

**Checklist: 13/13 passed.**

- [x] `pnpm plans:scope … --base 843e5e0`: 55 changed, all in scope; `--base e42de82`: 7 changed
      (`ipv4-network.ts`, `device.ts`, 4 test files, the plan), all declared.
- [x] `pnpm check` green (api 79 files / 988 passed / 5 skipped, 0 expected fails; contracts 283;
      arch: no violations; plans lint; harness).
- [x] `pnpm test:integration` green (16 files / 189 tests). Re-run even though the repair touches
      no `infrastructure/`.
- [x] Business rule (normalize the source IP) is in `domain/` (`device.ts:normalizeSourceIp`,
      `ipv4-network.ts:formatIpv4Address`); no `node:net` (arch green).
- [x] CQRS-lite, contracts, errors, Clock, migration, DI: unchanged by the repair (no contract,
      schema or registration change).
- [x] No secrets or personal data (test IPs are private / documentation ranges).
- [x] Repair note says "No deviations": matches the diff (only the two declared domain files in
      product code).
- [x] Docs: ADR 0014 and the runbook ("Redes permitidas" steps 1-2) describe exactly the flow
      that now works; nothing stale.

**Round-1 findings:**

- **M1 — closed.** `Device.markSeen` (`domain/device.ts:215-223`) normalizes through
  `normalizeSourceIp` (`device.ts:235-241`): `::ffff:a.b.c.d` / `a.b.c.d` are stored as `a.b.c.d`,
  so the value shown by `GET /attendance/devices` passes `z.ipv4()`. Confirmed end to end by the
  promoted test `apps/api/tests/attendance-device-network.test.ts:168-173` (read `lastSeenIp`,
  `PUT …/networks` with it → 204). The "IP changed" comparison uses the normalized value
  (`device-networks.test.ts`, mapped-equals-plain case), and rows persisted earlier with the
  mapped form self-heal on the next contact (normalized value differs → `saveContact`).
- **L1 — closed.** Anything that is neither IPv4 nor at most 45 chars of hex/`:`/`.` with a `:`
  becomes `null` before `saveContact`, so `VarChar(45)` cannot overflow from an
  `X-Forwarded-For` value. Covered by the `it.each` null cases in `device-networks.test.ts`.
  The barrier (`acceptsAddress`) still evaluates the raw `sourceIp`
  (`record-device-contact.command.ts:55`, `record-device-push.command.ts:60`), which is correct:
  it already unwraps the mapped form and rejects anything else on a restricted device.

**New findings: none** (no High, Medium or Low). Informational only, no action: the IPv6 shape
check is permissive (e.g. `1.2.3.4:80` or `:::` would be stored as-is); harmless, since the
value is display-only, bounded to 45 chars and never used for matching. No out-of-scope
discoveries.

Status → `verify`. Criterion 7 (physical checador receives a queued `USERINFO` after its IP is
allowed) remains for the verifier.

## Verification

**PASS on criteria 1–6; criterion 7 NOT VERIFIED (real device)** — 2026-10-05, main session
(inline, as the user asked), at `3c8301b` (includes the M1/L1 repair). Plan stays in `verify`.

- Suites at `3c8301b`: `pnpm check` green — `Tasks: 19 successful, 19 total`, api `988 passed |
5 skipped`, contracts `283 passed`, `no dependency violations found`, plans lint OK.
  `pnpm test:integration`: `Test Files 16 passed`, `Tests 189 passed`.
- Migration: `pnpm --filter @rrhh/api db:deploy` → `12 migrations found … No pending migrations
to apply` (`20261005165911_add_device_networks` already on the dev DB).
- Two API instances from the branch on the dev DB: `:3091` without `TRUST_PROXY` and `:3092`
  with `TRUST_PROXY=1` (`LOG_LEVEL=debug`). A script (scratchpad, not in the repo) created through
  the use cases a synthetic HOLDING_ADMIN, an HR user, the sede `Verificación 005 MUVT4J9L` and
  the device `VERIF005MUVT4J9L`, then drove HTTP and `/iclock` over `127.0.0.1`: **20/20 PASS**.
  - [x] C1: new device lists `allowedNetworks: []`, `lastSeenIp: null`; after a handshake,
        `lastSeenIp: "127.0.0.1"` (normalized; the socket reports `::ffff:127.0.0.1`).
  - [x] C2: pasting `lastSeenIp` into `PUT …/networks` → 204 and reads back `["127.0.0.1/32"]`;
        HR → 403; unknown id → 404 `DEVICE_NOT_FOUND`; `10.0.0.0/33` → 400; `::1` → 400.
  - [x] C3: with `["10.9.9.0/24"]`, handshake, `getrequest` and ATTLOG → `403 ERROR: dispositivo
no autorizado`, 0 punches stored, log `WARN zkteco: IP no permitida` with `serialNumber`
        and `sourceIp`. With `["127.0.0.1"]` → `200`, `OK`, `OK: 1`.
  - [x] C4: with networks a command is queued (201); with `[]` ATTLOG is still stored (`OK: 1`),
        queuing → 422 `DEVICE_NETWORK_UNRESTRICTED`, `getrequest` → `OK` and the command stays
        `QUEUED`; once networks are back it is delivered on the next poll.
  - [x] C5: race of the finding — covered by `prisma-device-networks.int.test.ts` (stale
        instance: each `save*` writes only its columns) in the green integration run; not timed
        live (the window is too short to reproduce by hand).
  - [x] C6: `:3092` + `X-Forwarded-For: 10.9.9.5` with `["10.9.9.0/24"]` → 200 and
        `lastSeenIp: "10.9.9.5"`; `:3091` with the same header → 403 (header ignored).
  - [x] Review L1: `:3092` with an 80-character junk `X-Forwarded-For` on a device without
        networks → 200 and `lastSeenIp: null` (no 500).
  - [ ] C7 **NOT VERIFIED**: needs the physical SenseFace 2A (set its IP from `lastSeenIp`, keep
        marking, receive a queued `USERINFO`). For the user.
- Logs: the queued command text (`PIN=VERIF005`) appears 0 times in either API log; 0 errors/500.
- Observations (not defects of this plan's criteria):
  - A client on IPv6 loopback (`fetch('http://localhost…')` resolved to `::1` in a first run) is
    shown as `lastSeenIp: "::1"` and cannot be allowed (`::1` → 400), so a restricted device
    rejects it. That is decision 13 (IPv4 only); ZKTeco devices connect over IPv4.
  - The `zkteco: IP no permitida` / `dispositivo no autorizado` warns log the **raw** `sourceIp`
    (`::ffff:127.0.0.1`), while `lastSeenIp` is normalized. Cosmetic: an admin copying the IP from
    the log instead of `GET …/devices` would get a 400. Not fixed (verifier does not fix).
- Synthetic rows left in the dev DB (as in earlier verifications): users
  `verif005-*-muvt4a9u|muvt4j9l@example.com`, sedes `Verificación 005 MUVT4A9U|MUVT4J9L`, devices
  `VERIF005MUVT4A9U|VERIF005MUVT4J9L` and their punches/commands. The first run (`…4A9U`) is the
  IPv6 one from the observation.
