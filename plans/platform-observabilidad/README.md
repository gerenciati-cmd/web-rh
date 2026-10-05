# platform-observabilidad — Readable logs and correct error responses

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status platform-observabilidad`. -->

## Goal

Keep the API console useful in development and the error responses correct for clients: device
polling must not bury the events that matter (the reply of a device command was lost on
2026-10-03 under `request completed` lines), a malformed body must be a client error, and
validation messages must be in Spanish like the rest of the API.

## Plans

| Plan                                              | Title                                             | Depends on           | Purpose                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------- |
| [001](001-sondeo-en-debug-y-errores-de-cuerpo.md) | Polling at debug, body errors, Spanish validation | platform-openapi/002 | Device polling request logs at debug; `MALFORMED_JSON` 400 and `PAYLOAD_TOO_LARGE` 413; Zod in Spanish. |

## Dependency notes

001 adds two error codes; they go into the error catalogue created by `platform-openapi/002`
(and its drift test would fail otherwise).

## Decisions with the user

1. (2026-10-03) The `request completed` line of the device polling (`GET /iclock/getrequest`,
   every ~10 s per device) goes to **debug**, not removed: visible with `LOG_LEVEL=debug`.
2. (2026-10-03) Improve the logs and fix the 500 on a malformed JSON body and the English
   validation messages found while showing the user every response code.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Removing the polling request log entirely**: discarded by decision 1 (still useful to
  diagnose a device that stops polling).
- **Raising the polling interval** (`Delay=10` in the handshake): commands would take longer to
  reach the device; the cost of polling is negligible (indexed lookups), the problem was only the
  log volume.
