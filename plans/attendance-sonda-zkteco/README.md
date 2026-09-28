# attendance-sonda-zkteco — Probe of the ZKTeco SenseFace 2A via ADMS push

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status attendance-sonda-zkteco`. -->

## Goal

Find out, against a real ZKTeco SenseFace 2A terminal, what the device sends to our API over the
ADMS/PUSH ("Cloud Server") protocol: handshake, attendance logs (marcaciones), user and
biometric events (fingerprint/face enrollment). This delivery is a **probe**: the API answers the
protocol and writes a redacted, structured log of every contact, so a later series can design
the real `attendance` module (marcación aggregate, persistence, legal rules) from observed traffic
instead of vendor assumptions.

## Plans

| Plan                                  | Title                               | Depends on | Purpose                                                                    |
| ------------------------------------- | ----------------------------------- | ---------- | -------------------------------------------------------------------------- |
| [001](001-recepcion-adms-solo-log.md) | ADMS push reception, log-only probe | —          | `/iclock/*` endpoints outside `/api/v1`, SN allowlist, redacted logs, ADR. |

## Dependency notes

None.

## Decisions with the user

1. (2026-09-28) Integration protocol: the device **pushes** to the API over HTTP (ADMS/iclock),
   configured in the device's Cloud Server / ADMS menu. The TCP 4370 pull SDK is discarded.
2. (2026-09-28) Scope of this delivery: **log only**. No database, no migration, no commands sent
   to the device, no JSON query endpoint.
3. (2026-09-28) Biometric data (fingerprint and face templates, photos): **metadata only**.
   Templates are never stored nor written to logs.
4. (2026-09-28) The code lives in the `attendance` module (registered as `planned`). The device
   is authenticated only by its serial number (`SN`), checked against an allowlist in the env
   var `ZKTECO_ALLOWED_SERIALS`.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Pull SDK over TCP 4370 (node-zklib and similar)**: requires the API to reach the device on the
  LAN, and the libraries are community-maintained reverse engineering. Discarded by decision 1.
- **Persisting raw payloads in an `attendance` schema**: useful later, but not needed to learn
  the protocol. Deferred by decision 2.
- **Forcing the device routes through `@rrhh/contracts` + `bindRoute`**: the protocol is
  `text/plain` with tab-separated lines and a positional text response. `bindRoute` always
  responds JSON (`apps/api/src/http/bind-route.ts:82-84`), and no web/mobile client consumes
  these routes. Recorded as an exception in ADR 0008 (plan 001).
