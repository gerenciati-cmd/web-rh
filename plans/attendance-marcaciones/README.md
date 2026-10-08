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

| Plan                                                   | Title                               | Depends on              | Purpose                                                                                                                                                |
| ------------------------------------------------------ | ----------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001](001-registro-de-equipos-y-marcaciones-crudas.md) | Device registry and raw marcaciones | —                       | `attendance` schema: devices (serial, name, time zone) replace the env allowlist; ATTLOG stored deduplicated; device status and punch query endpoints. |
| [002](002-atribucion-de-marcaciones-por-rfc.md)        | Attribution of marcaciones by RFC   | 001, employees-rfc/001  | Each punch whose PIN is a colaborador's RFC is attributed to them (resolved at read time); HR reads its companies' punches.                            |
| [003](003-checador-por-sede-y-desfase.md)              | Checador per sede and clock offset  | organization-sedes/001  | Device tied to a sede (zone copied from it, no free text); clock-offset measured on real-time pushes, flagged over 5 min.                              |
| [004](004-sonda-de-comandos-adms.md)                   | ADMS command probe                  | 003                     | Admin queues a raw `USERINFO` command; the next poll delivers it; replies logged. Confirms the protocol with the real device.                          |
| [005](005-barrera-de-red-y-escrituras-dirigidas.md)    | Network barrier and targeted writes | 004                     | Allowed IPv4 networks per device on `/iclock`; commands only for devices with networks; `TRUST_PROXY`; device writes no longer overwrite the sede.     |
| 006 (not written yet)                                  | Sync colaboradores to checadores    | 005, employees-sede/001 | Automatic + manual push of the sede's colaboradores (PIN = RFC), removal on termination, command bitácora.                                             |

## Dependency notes

002 needs 001's stored punches (it links existing rows, nothing is lost meanwhile) and the RFC on
the colaborador record, delivered by `employees-rfc/001` (another module, so another initiative).

003 needs the sede catalog (`organization-sedes/001`). 004 runs on a device that already has its
sede (003). The sync (006, numbered 005 before 2026-10-05) needed 004 to observe the real command
and reply formats, and needs the colaborador's sede and the change events from
`employees-sede/001`. Note for 006 (review L3 of `employees-sede/001`): a site change on a
TERMINATED colaborador also publishes `site-assigned`, so the sync must check
`EmployeeSummary.active` before pushing a user.

Review M1 of 004 (anyone who knows a serial number can poll `getrequest` and take a queued command
with a PIN and a name) is settled by decisions 11–13 and implemented in 005, which the sync
depends on: the sync only sends users to devices with allowed networks. Still for 006: take the
next command atomically (L2 of 004) and handle several results per `devicecmd` body (L3).

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
11. (2026-10-05) **Barrier for `/iclock`: allowed IP networks per device, enforced by the app**
    (not only by firewall/VPN). The production topology (public IP per sede, dynamic IP, VPN) is
    not decided yet; the app must protect itself whichever it is. Plan 005.
12. (2026-10-05) A device **without** allowed networks keeps sending marcaciones (nothing breaks
    on deploy) but **never receives commands**: queuing is refused and pending ones are not
    delivered. Commands carry RFC and name, so they only go to network-restricted devices.
13. (2026-10-05, architect, accepted with plan 005) Networks are **IPv4 only** (address or CIDR,
    up to 10 per device): the ADMS devices connect over IPv4 and a pure IPv4 matcher stays in
    `domain/`. The fix for the sede overwrite (finding
    `attendance-escritura-completa-del-equipo`) goes in the same plan: both touch the device
    repository and the `/iclock` use cases.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Device owned by one company** (and HR reading punches by device company): discarded by
  decision 2, devices are shared.
- **Keeping the allowlist in `.env`** extended to `serial:zone`: every new device would need a
  redeploy and server config edits. Discarded by decision 3.
- **Linking PIN → colaborador in plan 001**: bigger plan touching `employees`; deferred by
  decision 4 with no data loss, since the PIN is stored.
- **Only a network barrier (firewall, proxy, VPN) for `/iclock`**: no code, but depends on a
  topology not decided yet and leaves the app unprotected if the network is misconfigured.
  Discarded by decision 11 (it can still be added on top).
- **Accepting the M1 risk in an ADR**: RFC + name would go out to anyone with the serial number
  printed on the device. Discarded by decision 11.
- **Optimistic version column for the sede overwrite**: needs retries on the 10 s poll path;
  targeted column writes remove the conflict instead (plan 005).
- **Persisting OPLOG / USER / BIODATA records**: not needed for marcaciones; biometrics are
  excluded by decision 6. They stay log-only.
