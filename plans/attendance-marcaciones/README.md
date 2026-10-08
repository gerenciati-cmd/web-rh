# attendance-marcaciones — Persisted marcaciones from the ZKTeco devices

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status attendance-marcaciones`. -->

## Goal

Turn the log-only ZKTeco probe (`attendance-sonda-zkteco`, done) into durable data: the holding
registers its attendance devices, every marcación the devices push is stored once (deduplicated,
with its UTC instant), and staff can see from the API whether each device is alive and what it
sent. Later plans in this series link each device PIN to a colaborador, which is what lets HR of
each company see its own people's marcaciones. Shifts, jornadas, overtime and Mexican labor-law
(LFT) rules are a later series built on top of this raw data.

## Plans

| Plan                                                   | Title                               | Depends on             | Purpose                                                                                                                                                                                                          |
| ------------------------------------------------------ | ----------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-registro-de-equipos-y-marcaciones-crudas.md) | Device registry and raw marcaciones | —                      | `attendance` schema: devices (serial, name, time zone) replace the env allowlist; ATTLOG stored deduplicated; device status and punch query endpoints.                                                           |
| [002](002-atribucion-de-marcaciones-por-rfc.md)        | Attribution of marcaciones by RFC   | 001, employees-rfc/001 | Each punch whose PIN is a colaborador's RFC is attributed to them (resolved at read time); HR reads its companies' punches.                                                                                      |
| [003](003-checador-por-sede-y-desfase.md)              | Checador per sede and clock offset  | organization-sedes/001 | Device tied to a sede (zone copied from it, no free text); clock-offset measured on real-time pushes, flagged over 5 min.                                                                                        |
| [004](004-sonda-de-comandos-adms.md)                   | ADMS command probe                  | 003                    | Admin queues a raw `USERINFO` command; the next poll delivers it; replies logged. Confirms the protocol with the real device.                                                                                    |
| [005](005-escritura-dirigida-del-equipo.md)            | Targeted writes of the device row   | —                      | Device traffic writes only `lastSeenAt`/offset, the admin only sede/zone: a push no longer undoes a site change (finding, decision 11).                                                                          |
| [006](006-entrega-y-resultado-de-comandos.md)          | Reliable command delivery + results | 004                    | API-assigned `C:<n>:`, atomic take, results close commands DONE/FAILED, several results per body; ADR 0014 on M1 (decisions 12, 14).                                                                             |
| [007](007-sincronizacion-de-colaboradores.md)          | Sync colaboradores to checadores    | 005, 006, 008          | Automatic (employees events, networks enabled, sede change) + manual sync of the sede's colaboradores, PIN = RFC, removal on leave; skips those without RFC and devices without networks (decisions 13, 19, 20). |
| [008](008-barrera-de-red-y-escrituras-dirigidas.md)    | Network barrier and targeted writes | 004                    | Allowed IPv4 networks per device on `/iclock`; commands only for devices with networks; `TRUST_PROXY`; ADR 0015 (decisions 15–18). Numbered 005 on its branch.                                                   |

## Dependency notes

002 needs 001's stored punches (it links existing rows, nothing is lost meanwhile) and the RFC on
the colaborador record, delivered by `employees-rfc/001` (another module, so another initiative).

003 needs the sede catalog (`organization-sedes/001`). 004 runs on a device that already has its
sede (003). The sync (007; called 005, then 006, in earlier drafts) needed 004 to observe the real
command and reply formats, and needs the colaborador's sede and the change events from
`employees-sede/001`. Note for 007 (review L3 of `employees-sede/001`): a site change on a
TERMINATED colaborador also publishes `site-assigned`, so the sync must check
`EmployeeSummary.active` before pushing a user.

Before writing the sync (review of 004): **the user must decide the barrier for outgoing commands**
(M1: anyone who knows a serial number can poll `getrequest` and take a queued command with a PIN
and a name); the sync must take the next command atomically (L2) and handle several results per
`devicecmd` body (L3). Settled on 2026-10-06: M1 by decision 12; L2 and L3 in plan 006, which
the sync (007) builds on. 005 is independent but goes first because 007 changes the same
`AssignDeviceSite`.

**Two parallel lines (integrated 2026-10-08).** Plan 008 was written and implemented on another
branch as "005" (2026-10-05), before 005–007 existed here; both lines branched from the same
commit. 008 also fixes the finding with targeted writes; the integration kept 008's repository
names (`add`, `saveContact`, `saveSite`, `saveAllowedNetworks`) and 006's atomic take, now behind
008's network check. Inside 008 and ADR 0015, "plan 005" means 008, "plan 006" means 007, "ADR
0014" means 0015 and "decisions 11–13" mean 15–17. 007 was approved before 008 existed; it was
revised against 008 on 2026-10-08 (decisions 19–20) and went back to `draft` for re-approval; it
now depends on 008, which is `done` (same day, real device verified by the user).

## Decisions with the user

1. (2026-10-01) Going beyond the log-only probe is the right next step: the probe's goal (observe
   real traffic) was met, see the Verification of `attendance-sonda-zkteco/001`.
2. (2026-10-01) **Devices are shared**: one physical device may be used by colaboradores of
   several companies of the holding. A device does **not** belong to a company; a marcación's
   company comes from its colaborador (plan 002).
3. (2026-10-01) The registry of authorized devices (serial number, name, time zone) lives **in the
   database**, managed through an API endpoint. It replaces `ZKTECO_ALLOWED_SERIALS`. No web UI
   in this series' first plan.
4. (2026-10-01) The PIN → colaborador link is **not** in plan 001; it is plan 002. Plan 001 stores
   the PIN as received.
5. (2026-10-01) Read access: HR and HOLDING_ADMIN; registering devices: HOLDING_ADMIN only.
   Consequence of decision 2, applied in plan 001: until plan 002 links punches to colaboradores,
   a raw punch has no company, so HR (company-scoped) can see **device status** but only
   HOLDING_ADMIN can read **raw punches**. HR gets punch access, filtered by company, in 002.
6. (2026-09-28, carried over from `attendance-sonda-zkteco` decision 3) Biometric templates,
   photos, names, passwords and cards are never stored nor logged.
7. (2026-10-02) The devices enrol each person with their **full RFC (homoclave, uppercase) as the
   PIN**, as Buk does today. So the PIN ↔ colaborador link is the colaborador's RFC: no manual
   PIN assignment. Details and RFC rules in `employees-rfc` (README decisions 1–4).
8. (2026-10-02) Consequence of 2 and 7, applied in 002: a punch belongs to the colaborador whose
   RFC equals its PIN, and to that colaborador's company. HR gets `attendance.punches:read` and
   sees only its companies' colaboradores' punches; unmatched punches stay HOLDING_ADMIN-only.
9. (2026-10-02) The device keypad only accepts numeric user IDs; Buk creates users with the RFC as
   PIN remotely. So the API must push users to the device (ADMS commands). The protocol is not
   observed yet: plan 004 probes it before the real sync (plan 005) is designed.
10. (2026-10-02) Checadores belong to a sede, receive only its colaboradores, automatically and
    manually; on termination the user is removed from the device and the record kept; the test
    device's users "1" and "2" stay; the time zone comes from the sede (closed list); clock offset
    over 5 minutes is detected. Full wording: `organization-sedes` README decisions 1–4, 8–9.
11. (2026-10-06) Finding `attendance-escritura-completa-del-equipo`: fixed with **targeted
    writes** per use case (device traffic vs. admin), not with optimistic versioning (plan 005).
12. (2026-10-06) Review M1 of 004: the serial as the only device credential is **accepted while
    `/iclock` is reachable only from a controlled network**; exposing it to the internet first
    needs a barrier (proxy with IP allowlist or mTLS). Documented in ADR 0014 (plan 006).
    Partly superseded by decision 18.
13. (2026-10-06) Colaboradores **without RFC are not sent** to the checador; the sync reports them.
    The PIN for DO/CO colaboradores is decided when there are checadores there.
14. (2026-10-06) The command bitácora **keeps the device's result** (`Return` code → DONE/FAILED),
    so it shows whether a colaborador was loaded. The sync is split in two plans: command
    channel (006) and sync (007).
15. (2026-10-05, numbered 11 on its branch) **Barrier for `/iclock`: allowed IP networks per
    device, enforced by the app** (not only by firewall/VPN). The production topology (public IP
    per sede, dynamic IP, VPN) is not decided yet; the app must protect itself whichever it is.
    Plan 008.
16. (2026-10-05, numbered 12 on its branch) A device **without** allowed networks keeps sending
    marcaciones (nothing breaks on deploy) but **never receives commands**: queuing is refused and
    pending ones are not delivered. Commands carry RFC and name, so they only go to
    network-restricted devices.
17. (2026-10-05, numbered 13 on its branch; architect, accepted with plan 008) Networks are **IPv4
    only** (address or CIDR, up to 10 per device): the ADMS devices connect over IPv4 and a pure
    IPv4 matcher stays in `domain/`. The fix for the sede overwrite (finding
    `attendance-escritura-completa-del-equipo`) goes in the same plan: both touch the device
    repository and the `/iclock` use cases.
18. (2026-10-08) Decisions 12 and 15 were taken on parallel branches and contradict each other.
    The user keeps **15–17**: the barrier stays in the API (ADR 0015 partly supersedes ADR 0014).
    Decision 12 holds only in what 0015 does not change: inside an allowed network the serial is
    still the only credential.
19. (2026-10-08) With the barrier a new device has no networks, so the automatic sync of a device
    fires when its allowed networks go **from empty to non-empty** (and on a sede change), not on
    registration. Flow: register → `PUT …/networks` → the sede's colaboradores arrive. Plan 007.
20. (2026-10-08) An automatic sync **skips** a device without allowed networks (nothing queued,
    no registry row) and **logs a warn** with its `deviceId`; giving it networks catches it up
    (decision 19). A manual sync of such a device answers 422 `DEVICE_NETWORK_UNRESTRICTED`, like
    queuing a command (decision 16). Plan 007.
21. (2026-10-08, review of 007) A sync command is skipped as a duplicate **only when the most
    recent QUEUED command for that device and PIN is identical**. The device runs commands in
    queue order, so the last one decides; skipping because an identical one exists earlier
    could leave the device opposite to the `device_users` registry. Plan 007 (repair).

## Delivered

Series closed on 2026-10-08; plans 001–008 are `done`, all verified on the real SenseFace 2A
(firmware `ZAM70-NF24HA-Ver3.3.12`).

- **Devices in the database** (001, 003): registry of checadores per sede, time zone copied from
  the sede, last contact and clock offset (warned over 5 min) in `GET /attendance/devices`.
  ADR 0013.
- **Marcaciones stored** (001, 002): ATTLOG deduplicated with local time and UTC instant;
  attributed to the colaborador whose RFC equals the PIN; HR reads only its companies' punches.
- **Command channel** (004, 006): `USERINFO` commands queued by the API with `C:<n>:`, delivered
  once per poll even under concurrent polls, closed `DONE`/`FAILED` from the device's result;
  bitácora in `GET …/devices/:id/commands`. ADR 0014.
- **Network barrier** (008): allowed IPv4 networks per checador, `403` from any other IP,
  commands only for devices with networks, `TRUST_PROXY` behind a proxy. ADR 0015.
- **Targeted writes** (005, 008): device traffic and admin changes write disjoint columns, so a
  push no longer undoes a sede change.
- **Colaborador sync** (007): each checador holds its sede's active colaboradores with RFC
  (PIN = RFC), automatically and with `POST …/devices/:id/sync`; users the API did not create are
  never touched; `UPDATE` and `DELETE USERINFO` confirmed on the device.

Runbook: `docs/integraciones/zkteco-senseface-2a.md`. Not in this series: shifts, jornadas,
overtime and LFT rules (a later series on top of these marcaciones), a termination endpoint
(the sync already reacts to `EMPLOYEE_TERMINATED`), and web/mobile screens.

## Considered and discarded

- **Device owned by one company** (and HR reading punches by device company): discarded by
  decision 2, devices are shared.
- **Keeping the allowlist in `.env`** extended to `serial:zone`: every new device would need a
  redeploy and server config edits. Discarded by decision 3.
- **Linking PIN → colaborador in plan 001**: bigger plan touching `employees`; deferred by
  decision 4 with no data loss, since the PIN is stored.
- **Only a network barrier (firewall, proxy, VPN) for `/iclock`**: no code, but depends on a
  topology not decided yet and leaves the app unprotected if the network is misconfigured.
  Discarded by decision 15 (it can still be added on top).
- **Accepting the M1 risk in an ADR**: RFC + name would go out to anyone with the serial number
  printed on the device. Discarded by decision 15; it was what decision 12 and ADR 0014 did on the
  parallel branch, superseded by decision 18.
- **Optimistic version column for the sede overwrite**: needs retries on the 10 s poll path;
  targeted column writes remove the conflict instead (plans 005 and 008).
- **Persisting OPLOG / USER / BIODATA records**: not needed for marcaciones; biometrics are
  excluded by decision 6. They stay log-only.
