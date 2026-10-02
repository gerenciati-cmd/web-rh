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
| 005 (not written yet)                                  | Sync colaboradores to checadores    | 004, employees-sede/001 | Automatic + manual push of the sede's colaboradores (PIN = RFC), removal on termination, command bitácora. Written once 004 confirms the format.       |

## Dependency notes

002 needs 001's stored punches (it links existing rows, nothing is lost meanwhile) and the RFC on
the colaborador record, delivered by `employees-rfc/001` (another module, so another initiative).

003 needs the sede catalog (`organization-sedes/001`). 004 runs on a device that already has its
sede (003). 005 cannot be specified before 004 observes the real command and reply formats, and
needs the colaborador's sede and the change events from `employees-sede/001`.

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

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Device owned by one company** (and HR reading punches by device company): discarded by
  decision 2, devices are shared.
- **Keeping the allowlist in `.env`** extended to `serial:zone`: every new device would need a
  redeploy and server config edits. Discarded by decision 3.
- **Linking PIN → colaborador in plan 001**: bigger plan touching `employees`; deferred by
  decision 4 with no data loss, since the PIN is stored.
- **Persisting OPLOG / USER / BIODATA records**: not needed for marcaciones; biometrics are
  excluded by decision 6. They stay log-only.
