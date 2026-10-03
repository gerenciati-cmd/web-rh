---
status: review
module: platform
min_implementer: mid
depends_on: [platform-openapi/002]
---

# 001 — Device polling at debug, body errors and Spanish validation messages

## Context

Recon baseline: `6ac8c03`, 2026-10-03. Implements README decisions 1–2.

What exists today:

- `pino-http` logs one `request completed` entry at info for every request
  (`apps/api/src/http/app.ts:26-35`, no `customLogLevel`). The device polls
  `GET /iclock/getrequest` every 10 s (`Delay=10`,
  `apps/api/src/modules/attendance/http/zkteco-adms.parser.ts:100`), so with pino-pretty in
  development (`apps/api/src/infrastructure/logging/pino-logger.ts:13-15`) each poll prints a
  multi-line block. On 2026-10-03 the `zkteco: resultado de comando` line was lost from the user's
  console under these blocks (`attendance-marcaciones/004` Verification).
- Modules plug into the app through `AppModule` (`apps/api/src/shared/app-module.ts:12-27`);
  attendance contributes `deviceRouter` (`apps/api/src/modules/attendance/attendance.module.ts:69`).
  `app.ts` mounts device routers before `express.json` (`:37-42`).
- `LOG_LEVEL` defaults to `info` (`apps/api/src/config/env.ts:12`) but `apps/api/.env.example:4`
  sets `LOG_LEVEL=debug`, so a `.env` copied from it would still print the polling at debug.
- A malformed JSON body (`{"name": `) answers **500 `INTERNAL_ERROR`** (observed 2026-10-03 on
  `POST /api/v1/sites`): `express.json({ limit: '1mb' })` (`app.ts:42`) raises a body-parser
  error that `errorHandler` does not recognize, so it falls to the unexpected branch
  (`apps/api/src/http/error-handler.ts:77-81`). Body-parser marks these errors with
  `type: 'entity.parse.failed'` (and `'entity.too.large'` over the limit) and `status` 400/413.
- Zod's built-in messages come out in English (observed: `"Too small: expected string to have

> =2 characters"`in`VALIDATION_ERROR.details.issues`); only custom messages are Spanish. Zod
  4.6.5 ships a Spanish locale (`zod/v4/locales/es`), enabled globally with
  `z.config(z.locales.es())`.

**Approach.** Modules declare their high-frequency polling paths (`AppModule.quietRequestPaths`)
and `app.ts` gives `pino-http` a `customLogLevel` that logs a successful request on those paths at
debug; errors keep their level. `errorHandler` maps the two body-parser error types to stable
codes. The Spanish locale is configured once where the API's validation runs. Alternative
considered: hardcoding `/iclock/getrequest` in `app.ts` — rejected, the platform layer would know
an attendance protocol detail.

## Out of scope

- Other log changes (format, sampling, shipping to a service).
- The web and mobile apps' Zod messages (they set their own config if they need it).
- Changing the polling interval or the ADMS protocol answers.

## Dependencies

- `platform-openapi/002` — `API_ERRORS` in `packages/contracts/src/errors.ts` and the drift test
  `apps/api/tests/error-catalog.test.ts`, which this plan's new codes must satisfy.

## Steps

1. **Polling requests at debug**
   - Files: `apps/api/src/shared/app-module.ts` (modify), `apps/api/src/modules/attendance/attendance.module.ts` (modify), `apps/api/src/http/app.ts` (modify), `apps/api/.env.example` (modify)
   - Do: `AppModule` gets `readonly quietRequestPaths?: readonly string[]` (docblock: paths a
     device polls constantly; a successful request on them is logged at debug). Attendance
     declares `['/iclock/getrequest']`. In `app.ts`, collect the set from `modules` and pass
     `customLogLevel: (req, res, error) => error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : quiet.has(pathOf(req)) ? 'debug' : 'info'`
     where `pathOf` strips the query string from `req.url`. `.env.example`: `LOG_LEVEL=info`
     with a comment "debug muestra también el sondeo de los checadores".
   - Observable result: typecheck passes.

2. **Body errors as client errors**
   - Files: `apps/api/src/http/error-handler.ts` (modify), `packages/contracts/src/errors.ts` (modify), `apps/api/tests/error-catalog.test.ts` (modify)
   - Do: before the unexpected branch, recognize body-parser errors (an object with `type`
     `'entity.parse.failed'` → 400 `{ code: 'MALFORMED_JSON', message: 'El cuerpo de la petición
no es JSON válido' }`; `'entity.too.large'` → 413 `{ code: 'PAYLOAD_TOO_LARGE', message: 'El
cuerpo de la petición supera 1 MB' }`). Narrow with a small type guard, no `any`. Add both
     codes to `API_ERRORS` (status 400 and 413; extend `ApiErrorDoc['status']` with 413) with
     description and example.
   - Observable result: typecheck passes; the drift test passes.

3. **Spanish validation messages**
   - Files: `apps/api/src/http/bind-route.ts` (modify)
   - Do: at module level, `z.config(z.locales.es())` with a comment (the API answers in Spanish;
     custom messages in the contracts are already Spanish). Confirm it is the same Zod instance the
     contracts use (an HTTP test must see a Spanish built-in message).
   - Observable result: typecheck passes.

4. **Docs and regeneration**
   - Files: `packages/contracts/openapi.json` (modify), `docs/integraciones/zkteco-senseface-2a.md` (modify), `packages/contracts/src/openapi.test.ts` (modify), `apps/api/tests/request-logging-and-body-errors.test.ts` (create)
   - Do: regenerate the OpenAPI snapshot (new catalogue codes). Runbook: note that the polling
     `request completed` lines appear only with `LOG_LEVEL=debug`.
   - Observable result: `pnpm check` passes.

## Acceptance criteria

- [ ] With `LOG_LEVEL=info`, a device polling `GET /iclock/getrequest` every 10 s prints no
      `request completed` lines; `zkteco: …` events and other requests still print. With
      `LOG_LEVEL=debug` the polling lines appear.
- [ ] A polling request that fails (unknown serial, 403) still logs at warn.
- [ ] `POST /api/v1/sites` with body `{"name": ` → 400 `MALFORMED_JSON`; a body over 1 MB → 413
      `PAYLOAD_TOO_LARGE`; nothing logged as `unhandled error`.
- [ ] `POST /api/v1/sites` with `name: "X"` → 400 `VALIDATION_ERROR` whose issue message for `name`
      is in Spanish; the custom `timeZone` message is unchanged.
- [ ] Scalar's error table lists `MALFORMED_JSON` and `PAYLOAD_TOO_LARGE`.

## Test layers required

| Layer       | Applies | Focus                                                                       |
| ----------- | ------- | --------------------------------------------------------------------------- |
| domain      | no      |                                                                             |
| application | no      |                                                                             |
| contract    | yes     | catalogue entries present in the generated document                         |
| http        | yes     | malformed/too-large body codes; Spanish built-in message; log level by path |
| integration | no      |                                                                             |
| e2e         | no      | (no e2e infrastructure yet)                                                 |

## Deviations

- Cosmético: se tocó `apps/api/tests/error-catalog.test.ts` (fuera de la lista del plan) con dos
  entradas `generic(...)` (body-parser `entity.parse.failed` / `entity.too.large`). Sin ellas el test
  de deriva falla ("no documenta códigos que ninguna clase devuelve") por los dos códigos nuevos,
  y el plan exige que pase. Los tests por capas siguen siendo trabajo de la fase de tests.

## Test coverage

Línea base: `pnpm check` verde antes de escribir tests. Tests nuevos: 7 http en
`apps/api/tests/request-logging-and-body-errors.test.ts` (pino real a un arreglo, nivel debug) y
1 de contrato en `packages/contracts/src/openapi.test.ts`. Sin GAP ni NOT CONFIRMED.

| Comportamiento                                                       | Fuente                              | Capa     | Test                                                                        | Estado    |
| -------------------------------------------------------------------- | ----------------------------------- | -------- | --------------------------------------------------------------------------- | --------- |
| Sondeo `/iclock/getrequest` exitoso (con query) se loguea en debug   | `app.ts:30-36`, `attendance.module` | http     | `request-logging… › un sondeo exitoso (query incluida) va a debug`          | CONFIRMED |
| Otra ruta exitosa sigue en info                                      | `app.ts:35`                         | http     | `… › otras rutas exitosas siguen en info`                                   | CONFIRMED |
| Sondeo que falla (serie desconocida, 403) se loguea en warn          | `app.ts:34`                         | http     | `… › un sondeo que falla … en warn`                                         | CONFIRMED |
| JSON malformado → 400 `MALFORMED_JSON`, sin `unhandled error`        | `error-handler.ts:81-88`            | http     | `… › JSON malformado en POST /sites`                                        | CONFIRMED |
| Cuerpo > 1 MB → 413 `PAYLOAD_TOO_LARGE`, sin `unhandled error`       | `error-handler.ts:72-80`            | http     | `… › un cuerpo de más de 1 MB`                                              | CONFIRMED |
| Mensaje integrado de Zod en español                                  | `bind-route.ts:13`                  | http     | `… › name de una letra … en español`                                        | CONFIRMED |
| Mensaje propio de `timeZone` sin cambios                             | `site.contract.ts:36-39`            | http     | `… › el mensaje propio de timeZone …`                                       | CONFIRMED |
| Catálogo emite los dos códigos (ejemplos, portada con 400/413)       | `errors.ts`, `openapi.ts:218-229`   | contrato | `openapi.test.ts › el catálogo emite MALFORMED_JSON … y PAYLOAD_TOO_LARGE…` | CONFIRMED |
| Deriva catálogo ↔ códigos reales con las dos entradas `generic(...)` | `error-catalog.test.ts`             | http     | existente (tocado por el implementer)                                       | CONFIRMED |
| `LOG_LEVEL=info` en `.env.example`, nota en runbook (docs)           | `.env.example`, runbook             | —        | no testeable (config/documentación)                                         | n/a       |

## Review findings

## Verification
