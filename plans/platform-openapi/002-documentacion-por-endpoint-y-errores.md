---
status: review
module: platform
min_implementer: mid
depends_on: []
---

# 002 — Documentation per endpoint and documented errors in Scalar

## Context

Recon baseline: `6ac8c03`, 2026-10-03. Implements README decisions 7–9.

What exists today:

- `RouteDefinition` (`packages/contracts/src/http.ts:31-47`) has a one-line `summary` and no
  longer description, and no list of the errors a route can return.
- The generator (`packages/contracts/src/openapi.ts:23-80`, `operationFor` `:82-128`) emits for
  every operation only the success response plus `default: { $ref: '#/components/responses/Error' }`
  (`:124-127`); that single `Error` response says "400 validación, 401 …, 500 inesperado"
  (`:53-59`). Query/path parameters are emitted with `required` but without `description`
  (`parametersFrom`, `:131-155`), so Scalar shows no explanation and nothing about defaults.
- The committed `packages/contracts/openapi.json` has 2465 lines / 76 KB for 29 operations;
  models are already deduplicated in `components.schemas` (README decision 6).
- Error bodies all have the shape `ApiError { code, message, details? }`
  (`packages/contracts/src/common.ts:7-14`); the HTTP layer maps error categories to statuses
  (`apps/api/src/http/error-handler.ts:22-35`: NotFound 404, Conflict 409, InvalidValue and
  BusinessRuleViolation 422, Authentication 401, TooManyRequests 429; otherwise 400), plus
  `VALIDATION_ERROR` 400 (`:39-48`), `AUTHENTICATION_REQUIRED` 401 (`:50-54`), `FORBIDDEN` 403
  (`:56-60`), `INTERNAL_ERROR` 500 (`:79-81`) and `ROUTE_NOT_FOUND` 404 (`:84-90`).
- Error codes are defined in `apps/api/src/modules/{organization,employees,identity,attendance}/domain/errors.ts`
  (`readonly code = '…'`) and in `packages/domain/src/errors.ts` (`INVALID_VALUE`,
  `BUSINESS_RULE_VIOLATION`). Some codes are shared by several classes with the same meaning
  (`COMPANY_NOT_FOUND`, `EMPLOYEE_NOT_FOUND`, `SITE_NOT_FOUND`, `COMPANY_INACTIVE`, `SITE_INACTIVE`).
- Errors each use case returns (grep of `new …Error(` in `apps/api/src/modules/*/application`,
  2026-10-03; value objects called by the use case can add `INVALID_VALUE`/`WEAK_PASSWORD`, so the
  implementer confirms each route by reading its use case and its HTTP test):

  | Route (operationId)                        | Use case                                                           | Domain errors                                                                                                                                                     |
  | ------------------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `getCompany`                               | `get-company.query.ts`                                             | `COMPANY_NOT_FOUND`                                                                                                                                               |
  | `createCompany`                            | `create-company.command.ts`                                        | `COMPANY_ALREADY_EXISTS`                                                                                                                                          |
  | `createSite`                               | `create-site.command.ts`                                           | `SITE_ALREADY_EXISTS`                                                                                                                                             |
  | `registerEmployee`                         | `register-employee.command.ts`                                     | `COMPANY_NOT_FOUND`, `COMPANY_INACTIVE`, `SITE_NOT_FOUND`, `SITE_INACTIVE`, `SITE_COUNTRY_MISMATCH`, `EMPLOYEE_ALREADY_EXISTS`, `EMPLOYEE_RFC_ALREADY_REGISTERED` |
  | `assignEmployeeRfc`                        | `assign-employee-rfc.command.ts`                                   | `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_RFC_ALREADY_REGISTERED`, `RFC_NOT_APPLICABLE` (domain)                                                                            |
  | `assignEmployeeSite`                       | `assign-employee-site.command.ts`                                  | `EMPLOYEE_NOT_FOUND`, `COMPANY_NOT_FOUND`, `SITE_NOT_FOUND`, `SITE_INACTIVE`, `SITE_COUNTRY_MISMATCH`                                                             |
  | `registerDevice`                           | `register-device.command.ts`                                       | `SITE_NOT_FOUND`, `SITE_INACTIVE`, `DEVICE_ALREADY_REGISTERED`                                                                                                    |
  | `assignDeviceSite`                         | `assign-device-site.command.ts`                                    | `DEVICE_NOT_FOUND`, `SITE_NOT_FOUND`, `SITE_INACTIVE`                                                                                                             |
  | `queueDeviceCommand`, `listDeviceCommands` | `queue-device-command.command.ts`, `list-device-commands.query.ts` | `DEVICE_NOT_FOUND`                                                                                                                                                |
  | `logIn`                                    | `log-in.command.ts`                                                | `INVALID_CREDENTIALS`, `LOGIN_TEMPORARILY_BLOCKED`                                                                                                                |
  | `activateAccount`                          | `activate-account.command.ts`                                      | `INVITATION_NOT_VALID`, `EMAIL_ALREADY_REGISTERED`, `EMPLOYEE_ALREADY_HAS_ACCESS`, `WEAK_PASSWORD`                                                                |
  | `inviteEmployee`                           | `invite-employee.command.ts`                                       | `EMPLOYEE_NOT_FOUND`, `EMPLOYEE_INACTIVE`, `EMPLOYEE_ALREADY_HAS_ACCESS`, `EMAIL_ALREADY_REGISTERED`                                                              |
  | `inviteExternal`                           | `invite-external.command.ts`                                       | `EMAIL_ALREADY_REGISTERED`                                                                                                                                        |
  | `assignRole`                               | `assign-role.command.ts`                                           | `USER_NOT_FOUND`, `COMPANY_NOT_FOUND`, `COMPANY_INACTIVE`, `ROLE_ALREADY_ASSIGNED` (+ `ROLE_NOT_ASSIGNABLE`, `INVALID_ROLE_SCOPE` from the domain)                |
  | `listRoleAssignments`                      | `list-role-assignments.query.ts`                                   | `USER_NOT_FOUND`                                                                                                                                                  |
  | `revokeRoleAssignment`                     | `revoke-role-assignment.command.ts`                                | `ROLE_ASSIGNMENT_NOT_FOUND`, `LAST_HOLDING_ADMIN`                                                                                                                 |
  | `resetPassword`                            | `reset-password.command.ts`                                        | `PASSWORD_RESET_NOT_VALID`, `WEAK_PASSWORD`                                                                                                                       |
  | `forceEmployeePasswordReset`               | `force-employee-password-reset.command.ts`                         | `EMPLOYEE_NOT_FOUND`, `USER_NOT_FOUND`, `USER_DISABLED`                                                                                                           |
  | `forceUserPasswordReset`                   | `force-user-password-reset.command.ts`                             | `USER_NOT_FOUND`, `USER_DISABLED`                                                                                                                                 |

  Routes without domain errors: `listCompanies`, `listSites`, `listEmployees`, `listDevices`,
  `listPunches`, `listUsers`, `logOut`, `me`, `requestPasswordReset` (always answers the same, to
  not reveal accounts).

What we need (decisions 7–9): every endpoint in Scalar says what it does, who may call it, what
it needs (with optional fields marked and defaults explained) and exactly which errors it can
return, each with an example body — without turning `openapi.json` into a huge file.

**Approach.** One **error catalogue** in contracts (`API_ERRORS`: code → status, Spanish
description, example body). Each route declares a `description` (markdown) and the domain error
codes it can return (`errors`). The generator derives the generic responses from what the route
already declares (400 if it receives params/query/body, 401 unless public, 403 if it requires a
permission) and adds the declared codes grouped by status. Size control: every example lives
ONCE in `components.examples` and every error response ONCE in `components.responses`; operations
only hold `$ref`s (enforced by a test). Expected growth is about +900 lines (29 descriptions,
about 40 examples, references), not a copy per route. A drift test in the API keeps the catalogue
equal to the codes the code can actually return. Alternative considered: generating the error
list per route from the use cases automatically — rejected, there is no runtime link from a route
to its use case's error types without changing every use case's signature.

## Out of scope

- Changing any error code, status or message in the API (only documenting them). `MALFORMED_JSON`
  and Spanish Zod messages are `platform-observabilidad/001`.
- Response examples for successful bodies (the schemas already show their shape).
- Splitting `openapi.json` into several files (README decision 6 stands).
- Web/mobile UI; the Scalar bundle version.

## Dependencies

None

## Steps

1. **Error catalogue**
   - Files: `packages/contracts/src/errors.ts` (create), `packages/contracts/src/index.ts` (modify)
   - Do: `export const API_ERRORS = { CODE: { status, description, example } , … } as const satisfies Record<string, ApiErrorDoc>`
     with `interface ApiErrorDoc { status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500; description: string; example: ApiErrorBody }`.
     One entry per distinct code: the generic ones (`VALIDATION_ERROR` 400, `AUTHENTICATION_REQUIRED`
     401, `FORBIDDEN` 403, `ROUTE_NOT_FOUND` 404, `INTERNAL_ERROR` 500, `INVALID_VALUE` 422) and
     every code in the four `errors.ts` files of the Context (shared codes once). `description`:
     when it happens, in Spanish, one sentence. `example`: the real `message` of the error class
     and realistic `details` keys (copy them from the class constructor; synthetic values, no real
     personal data). `export type ApiErrorCode = keyof typeof API_ERRORS`. Export both from
     `index.ts`.
   - Observable result: contracts typecheck passes.

2. **Route definition**
   - Files: `packages/contracts/src/http.ts` (modify)
   - Do: `RouteDefinition` gets `readonly description: string` (required; markdown: what it does,
     who may call it, what it needs, side effects) and `readonly errors?: readonly ApiErrorCode[]`
     (only domain codes, 404/409/422/429; the generic 400/401/403 are derived). Docblocks in
     Spanish.
   - Observable result: typecheck lists every route without `description` (fixed in step 4).

3. **Generator**
   - Files: `packages/contracts/src/openapi.ts` (modify)
   - Do:
     - `operationFor`: add `description: route.description`. Responses: success as today; `400`
       → `$ref: '#/components/responses/ValidationError'` when the route has `params`, `query` or
       `body`; `401` → `Unauthenticated` unless `access.kind === 'public'`; `403` → `Forbidden`
       when `access.kind === 'permission'`; for each status among the declared `errors`, one
       response whose description is the codes joined with ", " and whose
       `content['application/json']` has `schema: { $ref: ApiError }` and
       `examples: { CODE_A: { $ref: '#/components/examples/CODE_A' }, … }` (only references; the
       example bodies live in `components.examples`). Keep `default` →
       `#/components/responses/Error` for 500.
     - `components.examples`: one entry per catalogue code (`summary` = code, `value` = example).
     - `components.responses`: `ValidationError`, `Unauthenticated`, `Forbidden` (with their
       catalogue example) and `Error` (500).
     - `parametersFrom`: lift the property's `description` to the parameter (`description`
       field) so Scalar shows it next to the name.
     - `info.description` (markdown): how to authenticate in Scalar (log in with
       `client: "mobile"`, paste the token), error shape `{ code, message, details? }`,
       pagination (`page` default 1, `pageSize` default 20, max 100), and a table of every error
       code with status and description generated from `API_ERRORS`.
   - Observable result: `buildOpenApiDocument(apiRoutes)` builds without throwing.

4. **Descriptions and errors for the 29 routes; field descriptions**
   - Files: `packages/contracts/src/organization/company.contract.ts` (modify), `packages/contracts/src/organization/site.contract.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/src/identity/auth.contract.ts` (modify), `packages/contracts/src/identity/access.contract.ts` (modify), `packages/contracts/src/identity/invitation.contract.ts` (modify), `packages/contracts/src/identity/password-reset.contract.ts` (modify), `packages/contracts/src/attendance/device.contract.ts` (modify), `packages/contracts/src/attendance/punch.contract.ts` (modify), `packages/contracts/src/attendance/device-command.contract.ts` (modify), `packages/contracts/src/common.ts` (modify)
   - Do: every `defineRoute` gets a `description` (Spanish, 2–6 lines: qué hace, quién puede
     (role/permission in words; HR scoped to its companies when `companyParam`), qué necesita,
     efectos) and `errors` from the Context table (confirm each against its use case; add
     value-object errors found there). Every field of every **input** schema (bodies, params,
     queries) and every field of the read models that is not self-evident gets `.describe()`;
     optional fields start with "Opcional." and say what happens when omitted; fields with
     `.default()` state the default. `PageQuerySchema` (`common.ts:16-19`) describes `page` and
     `pageSize`. Do not change any validation rule.
   - Observable result: contracts typecheck passes.

5. **Snapshot, structure test and drift test**
   - Files: `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify), `apps/api/tests/error-catalog.test.ts` (create), `packages/contracts/src/identity/access.contract.test.ts` (modify), `apps/api/tests/authorization.test.ts` (modify), `apps/api/tests/error-examples.test.ts` (create)
   - Do: regenerate the snapshot (`pnpm --filter @rrhh/contracts openapi`). In `openapi.test.ts`
     add: every operation has a non-empty `description`; no operation contains an inline
     `example`/`examples` value (only `$ref`), so examples exist once; every code declared by a
     route exists in `components.examples`. In the API, `error-catalog.test.ts` reads the source
     of `src/modules/*/domain/errors.ts`, `src/http/request-context.ts`,
     `src/http/request-validation-error.ts` and `src/http/error-handler.ts`, extracts every
     `code = '…'` / `code: '…'` literal, and asserts each is a key of `API_ERRORS`; for the
     classes in `errors.ts` it also asserts the catalogue status matches the category they
     extend (`NotFoundError` 404, `ConflictError` 409, `BusinessRuleViolationError` and
     `InvalidValueError` 422, `AuthenticationError` 401, `TooManyRequestsError` 429).
   - Observable result: `pnpm check` passes; note the new line count of `openapi.json` in
     Deviations (expected about 3,400 lines).

## Acceptance criteria

- [ ] In `/api/v1/docs`, `PUT /companies/{companyId}/employees/{employeeId}/site` shows a
      description (what, who, needs), the body field `siteId` described, and responses 204, 400,
      401, 403, 404 (`EMPLOYEE_NOT_FOUND`, `SITE_NOT_FOUND`, `COMPANY_NOT_FOUND` with examples)
      and 422 (`SITE_INACTIVE`, `SITE_COUNTRY_MISMATCH` with examples).
- [ ] `GET /attendance/punches` shows every query parameter with its description and "Opcional";
      `page`/`pageSize` show their defaults.
- [ ] `POST /auth/login` shows no 401-for-missing-session/403 responses (public) but shows 401
      `INVALID_CREDENTIALS` and 429 `LOGIN_TEMPORARILY_BLOCKED`.
- [ ] The intro of the reference explains authentication, the error shape and pagination, and
      lists every error code with its status.
- [ ] Each example body shown matches what the running API returns for that case (spot-check
      `SITE_ALREADY_EXISTS`, `FORBIDDEN`, `VALIDATION_ERROR`, `SITE_COUNTRY_MISMATCH`).
- [ ] `openapi.json` holds each example once (`components.examples`) and stays under 4,000 lines.

## Test layers required

| Layer       | Applies | Focus                                                                                   |
| ----------- | ------- | --------------------------------------------------------------------------------------- |
| domain      | no      |                                                                                         |
| application | no      |                                                                                         |
| contract    | yes     | generator: derived 400/401/403, per-status grouping, `$ref` only, parameter description |
| http        | yes     | drift test of the catalogue vs. the API's error classes; `/openapi.json` served         |
| integration | no      |                                                                                         |
| e2e         | no      | (no e2e infrastructure yet)                                                             |

## Deviations

Fecha: 2026-10-03. Pasos 1–5 hechos (5/5).

1. **Cosmético, fuera de la lista de archivos**: dos tests existentes afirmaban el comportamiento
   que este plan reemplaza a propósito (`components.responses.Error` mencionaba "403"; ahora `Error`
   es solo el 500 y el 403 vive en `components.responses.Forbidden`). Se actualizaron con el mínimo
   cambio: `packages/contracts/src/identity/access.contract.test.ts` (test "la respuesta Forbidden
   documenta el 403") y `apps/api/tests/authorization.test.ts` (afirma `responses['403']` →
   `$ref` a `Forbidden`). Estos dos tests, más `apps/api/tests/error-examples.test.ts` (creado por
   el tester), se añadieron DESPUÉS de la aprobación a la lista de archivos del paso 5 (ver 6);
   por eso hoy `plans:scope` los acepta. Corregido en la ronda de reparación 1.
2. **Cosmético**: en `openapi.test.ts` también se ajustó el test de ronda 1 "cada operación
   referencia components.responses.Error como respuesta default": ya no exige que falten 400/401
   (ahora se derivan como `$ref`); sí sigue exigiendo el `default`. Ese archivo sí está en la lista.
3. Líneas finales de `packages/contracts/openapi.json`: **3,838** (el plan estimaba ~3,400; el
   criterio de aceptación pide < 4,000: se cumple).
4. `ROUTE_NOT_FOUND` lleva el mensaje `No existe GET /nada` en el ejemplo (el handler real arma
   `No existe ${method} ${path}`). **Corregido en la ronda 1**: el ejemplo ahora dice
   `No existe GET /api/v1/nada`. Además, esta desviación afirmaba que `BUSINESS_RULE_VIOLATION`
   no estaba en el catálogo porque "ninguna clase concreta lo emite": era falso;
   `employee.ts:73-79` lo devuelve por HTTP (422, contratación con más de 90 días de anticipación).
   Ronda 1: añadido a `API_ERRORS` y declarado en `registerEmployee`.
5. Los criterios de aceptación que exigen ver `/api/v1/docs` y comparar ejemplos con el API en
   marcha (`SITE_ALREADY_EXISTS`, `FORBIDDEN`, `VALIDATION_ERROR`, `SITE_COUNTRY_MISMATCH`) NO se
   ejercieron en esta fase: quedan para `verify`. Los mensajes de `details` del ejemplo
   `VALIDATION_ERROR` (issue de Zod con `origin`/`format`) están por confirmar contra el API real.
6. **Ronda de reparación 1 (implementer, 2026-10-03)**, contratos: (a) `API_ERRORS[code].example`
   pasó a `examples: { default, [variante] }` y `RouteDefinition.errors` acepta
   `ApiErrorCode | { code, variant }` (`ApiErrorRef`, helpers `errorRefCode/errorRefVariant`); el
   generador emite `components.examples.<CODE>` y `<CODE>__<variante>` una vez cada uno. Variantes:
   `COMPANY_INACTIVE__role_assignment` (`assignRole`) y `EMPLOYEE_NOT_FOUND__identity` (sin
   `details`; `inviteEmployee`, `forceEmployeePasswordReset`). `COMPANY_NOT_FOUND`, `SITE_NOT_FOUND`,
   `SITE_INACTIVE` revisados: mismo cuerpo en todos los módulos, sin variante. (b) `VALIDATION_ERROR`
   ejemplo con `pattern` (patrón de uuid de Zod 4; solo se compara por claves); `ROUTE_NOT_FOUND`
   con `/api/v1/nada`; `INVALID_VALUE` con un mensaje real (`Nombre y apellido son obligatorios`) y
   descripción que dice que Zod responde antes (400) y que ninguna ruta lo declara.
   (c) Para mantener `pnpm check` en verde se tocaron mínimamente archivos de tests: `openapi.test.ts`
   (dos aserciones aceptan variantes + un test nuevo de variante), `error-catalog.test.ts` y
   `error-examples.test.ts` (`.example` → `.examples.default`; los dos `it.fails` promovidos a `it`
   porque los ejemplos ya coinciden). El tester sigue con el punto 6 del review (reemplazar
   `error-catalog.test.ts`) y debe cubrir también `BUSINESS_RULE_VIOLATION` e `INVALID_VALUE`.
7. **Historial**: la lista de archivos del paso 5 se amplió después de la aprobación con
   `access.contract.test.ts`, `authorization.test.ts` y `error-examples.test.ts`; registrado aquí y
   en la desviación 1.
8. **Paso 5, test de deriva (ronda de reparación 1, hallazgo 6, tester)**: `error-catalog.test.ts`
   ya no lee los fuentes como texto (antipatrón de `testing.md`). Ahora importa los `errors.ts` de
   los cuatro módulos, instancia cada clase exportada que extiende `DomainError` (más
   `InvalidValueError`, `BusinessRuleViolationError`, `RequestValidationError`,
   `AuthenticationRequiredError`, `PermissionDeniedError` y un error inesperado), las pasa por el
   `errorHandler` real y compara status, `code`, `message` (salvo en las bases genéricas, cuyo
   mensaje lo pone quien lanza) y claves de `details` contra `API_ERRORS`, incluidas las variantes
   (`COMPANY_INACTIVE/role_assignment`, `EMPLOYEE_NOT_FOUND/identity`, mapeadas por clase en el
   test). También falla si el catálogo documenta un código o variante que ninguna clase emite
   (`ROUTE_NOT_FOUND` se excluye: sale de `notFoundHandler`, lo cubre `error-examples.test.ts`).
   Limitación: la instanciación usa argumentos de relleno por clase (tabla `ARGS_BY_CLASS` para las
   dos con argumentos numéricos); una clase nueva con otra firma hará fallar el test ruidosamente.

## Test coverage

Baseline `pnpm check` (2026-10-03): verde (contracts 257, api 823 + 5 skipped). Las pruebas de los
pasos 1–5 ya las dejó el Implementer (`openapi.test.ts`, `error-catalog.test.ts`); el tester
agregó `apps/api/tests/error-examples.test.ts` para el criterio "cada ejemplo coincide con lo que
devuelve el API".

| Comportamiento                                                                                                                                                              | Fuente                                     | Capa     | Test                                                                                               | Estado                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Toda operación tiene `description` no vacía                                                                                                                                 | `openapi.ts` `operationFor`                | contract | `openapi.test.ts › toda operación lleva una descripción no vacía`                                  | CONFIRMED                                                               |
| Ejemplos solo por `$ref` en operaciones (una vez en `components.examples`)                                                                                                  | `openapi.ts`                               | contract | `openapi.test.ts › los ejemplos de error solo viven…`                                              | CONFIRMED                                                               |
| Código declarado por una ruta existe en `components.examples`                                                                                                               | `http.ts`, `openapi.ts`                    | contract | `openapi.test.ts › todo código declarado…`                                                         | CONFIRMED                                                               |
| 400/401/403 derivados; ruta pública sin 401/403 derivados; solo 401 en `me`                                                                                                 | `openapi.ts`                               | contract | `openapi.test.ts › deriva 400/401/403…`, `una ruta pública…`, `una ruta autenticada…`              | CONFIRMED                                                               |
| Errores agrupados por status con un ejemplo por código                                                                                                                      | `openapi.ts`                               | contract | `openapi.test.ts › agrupa los errores declarados por status…`                                      | CONFIRMED                                                               |
| Descripción del campo se copia al parámetro                                                                                                                                 | `openapi.ts` `parametersFrom`              | contract | `openapi.test.ts › copia la descripción del esquema al parámetro`                                  | CONFIRMED                                                               |
| Portada: autenticación, paginación y todos los códigos                                                                                                                      | `openapi.ts`                               | contract | `openapi.test.ts › la portada explica…`                                                            | CONFIRMED                                                               |
| Error declarado con status ya derivado lanza                                                                                                                                | `openapi.ts`                               | contract | `openapi.test.ts › lanza si una ruta declara un error…`                                            | CONFIRMED                                                               |
| Snapshot `openapi.json` al día                                                                                                                                              | `openapi.json`                             | contract | `openapi.test.ts › openapi.json está al día…`                                                      | CONFIRMED                                                               |
| Catálogo = códigos que el código emite; status = categoría de la clase                                                                                                      | `errors.ts` de módulos, `http/*`           | http     | `error-catalog.test.ts` (7 tests; instancia las clases por el errorHandler real, ver desviación 8) | CONFIRMED                                                               |
| `/openapi.json` servido sin sesión                                                                                                                                          | `docs.router.ts`                           | http     | `docs.test.ts` (existente)                                                                         | CONFIRMED                                                               |
| Ejemplo coincide con la respuesta real: `SITE_ALREADY_EXISTS`, `FORBIDDEN`, `AUTHENTICATION_REQUIRED`, `SITE_COUNTRY_MISMATCH` (status, code, message, claves de `details`) | `errors.ts` ejemplos                       | http     | `error-examples.test.ts` (4 tests)                                                                 | CONFIRMED                                                               |
| Ejemplo `ROUTE_NOT_FOUND` coincide con la respuesta real                                                                                                                    | `errors.ts`, `error-handler.ts`            | http     | `error-examples.test.ts › ROUTE_NOT_FOUND`                                                         | CONFIRMED (ronda 1: ejemplo corregido; `it.fails` promovido a `it`)     |
| Ejemplo `VALIDATION_ERROR` coincide con la respuesta real                                                                                                                   | `errors.ts`, `request-validation-error.ts` | http     | `error-examples.test.ts › VALIDATION_ERROR`                                                        | CONFIRMED (ronda 1: ejemplo con `pattern`; `it.fails` promovido a `it`) |
| Vista en `/api/v1/docs` (Scalar renderizado)                                                                                                                                | —                                          | e2e      | —                                                                                                  | NOT CONFIRMED: sin infraestructura e2e; queda para verify               |

Ronda de reparación 1 (tester): `error-catalog.test.ts` reescrito (7 tests, antes 5). Los dos
`it.fails` de `error-examples.test.ts` ya eran `it` (promovidos por el Implementer, desviación 6c).
Conteo final: http 6 en `error-examples.test.ts` + 7 en `error-catalog.test.ts`; contract 0 nuevos.
Los dos GAP anteriores quedaron resueltos al corregir los ejemplos.

## Review findings

Fecha: 2026-10-03. Reviewer (subagente). Base del diff: `5567936`..`HEAD` (`0af2d93`), árbol limpio.

### Pass 1 — Checklist: 12/13

- [x] `pnpm plans:scope … --base 5567936`: todo dentro del alcance (22 cambiados / 21 declarados + el
      plan); `packages/contracts/src/index.ts` es append-only (una línea `export * from './errors'`).
- [x] `pnpm check` verde: contracts 257, api 827 + 2 expected fail (los `it.fails` del tester) + 5
      skipped, domain 98, web 2, mobile 5, api-client 3; format, lint, arch, plans, harness OK.
- [x] Integración: N/A (no cambió `infrastructure/` ni el esquema).
- [x] Reglas de negocio: ninguna nueva; solo documentación en contracts.
- [x] CQRS: N/A.
- [x] Tipos de `@rrhh/contracts`: `ApiErrorCode`/`ApiErrorStatus` derivados del catálogo, sin duplicados.
- [x] Errores esperados: no se cambió ningún código, status ni mensaje del API.
- [x] Money/fechas/Clock: N/A.
- [x] Migración: N/A.
- [x] DI: N/A.
- [x] Sin secretos ni datos reales (ids UUID sintéticos, CURP/RFC de prueba ya usados en el repo).
- [ ] **`## Deviations` honesto**: falla. La desviación 4 afirma que `BUSINESS_RULE_VIOLATION` no
      está en el catálogo porque "ninguna clase concreta lo emite"; el código sí lo devuelve por HTTP
      (ver Major 1). La desviación 1 está desactualizada: dice que `plans:scope` lista dos tests
      fuera de alcance, pero la lista de archivos del paso 5 se amplió después (diff del plan) y
      ahora `plans:scope` pasa; la ampliación no quedó registrada (Low 7).
- [x] Docs: nada queda falso (ver Low 8 sobre recetas incompletas).

### Pass 2 — Hallazgos

**Major**

1. `BUSINESS_RULE_VIOLATION` es alcanzable y no está documentado. `apps/api/src/modules/employees/domain/employee.ts:73-79`
   devuelve `new BusinessRuleViolationError('No se puede registrar una contratación con más de 90 días de anticipación')`
   (código por defecto `BUSINESS_RULE_VIOLATION`, `packages/domain/src/errors.ts:24-26`); el
   contrato no lo puede atajar (`hireDate: z.iso.date()`, `employee.contract.ts:44`; depende del
   reloj). Escenario: `POST /companies/{id}/employees` con `hireDate` a 120 días → 422
   `BUSINESS_RULE_VIOLATION`, pero Scalar no lo lista en `registerEmployee` (`employee.contract.ts:146-154`)
   y el código no existe en `API_ERRORS` (`packages/contracts/src/errors.ts`). El test de deriva no
   lo detecta porque solo busca literales `code = '…'` y este error es una instancia directa de la
   clase base. Falla la meta "exactamente qué errores puede devolver". Arreglo esperado: entrada
   `BUSINESS_RULE_VIOLATION` (422) en el catálogo, declararla en `registerEmployee`, y que el test
   de deriva cubra los códigos por defecto de las clases base (como ya hace a mano con `INVALID_VALUE`).
   (Las demás instancias directas, `employee.ts:113,117` de `terminate`, no tienen ruta hoy.)
2. El ejemplo `VALIDATION_ERROR` no coincide con lo que devuelve el API (`packages/contracts/src/errors.ts:36-44`):
   el issue real de un uuid inválido trae además la clave `pattern`. Es uno de los cuatro ejemplos
   que el criterio de aceptación pide comprobar explícitamente. Confirmado por el `it.fails` del
   tester (`apps/api/tests/error-examples.test.ts:83-104`, en verde como expected fail). Al
   corregirlo, ese `it.fails` debe pasar a `it`.

**Minor**

3. Ejemplo de `ROUTE_NOT_FOUND` incorrecto (`errors.ts:62`): `notFoundHandler` usa `req.path` a nivel
   de app (`apps/api/src/http/error-handler.ts:84-90`), así que el mensaje real es
   `No existe GET /api/v1/nada`, no `No existe GET /nada`. Confirmado por `error-examples.test.ts:74-81`.
   La desviación 4 lo reconoce como diferencia pero la acepta; es un ejemplo que no coincide con el API.
4. `COMPANY_INACTIVE` tiene dos mensajes reales y el catálogo muestra solo uno. El ejemplo
   (`errors.ts:99-101`) usa el de employees ("No se puede contratar en una empresa inactiva"), pero
   `assignRole` declara el código (`access.contract.ts:105-112`) y devuelve "No se puede asignar un
   rol en una empresa inactiva" (`identity/domain/errors.ts:103-108`). Escenario: en Scalar,
   `POST /users/{userId}/role-assignments` → 422 muestra un mensaje que esa ruta nunca devuelve.
5. `EMPLOYEE_NOT_FOUND` tiene dos cuerpos reales. El ejemplo (`errors.ts:128-132`) incluye
   `details.employeeId`, pero el `EmployeeNotFoundError` de identity (`identity/domain/errors.ts:140-146`)
   no tiene `details`. Escenario: en `inviteEmployee` y `forceEmployeePasswordReset` el 404 muestra
   un `details` que el API nunca manda. (Los puntos 4 y 5 vienen del mismo problema: un ejemplo por
   código mientras varias clases comparten código. Opciones: un ejemplo neutral (sin `details` / mensaje
   común) o una nota en la `description`; lo decide quien implemente, sin cambiar el API.)
6. `apps/api/tests/error-catalog.test.ts` busca texto en el código fuente, y eso es el antipatrón 1
   de `docs/harness/conventions/testing.md:58`. El paso 5 del plan lo pedía así, pero **hay una
   alternativa razonable y más fuerte**, así que no lo veo justificado:
   - Descubrir las clases con `import.meta.glob('../src/modules/*/domain/errors.ts', { eager: true })`
     (sigue detectando módulos nuevos sin lista a mano; los tests de `apps/api/tests` ya importan
     `@/modules/*/domain`), quedarse con los exports que son subclase de `DomainError` e instanciarlos
     con `Reflect.construct(Cls, ['x', 'x', 'x'])`. Todos los constructores aceptan strings o números
     que solo van al mensaje o a `details`.
   - Pasar cada instancia por el `errorHandler` real (o una mini app de express con supertest) y
     comparar status, `code` y claves de `details` contra `API_ERRORS`. Así desaparece la copia
     `STATUS_BY_CATEGORY` del test (`error-catalog.test.ts:35-42`), que hoy puede divergir de
     `error-handler.ts:22-32` sin que nada falle, y además saldrían a la luz los puntos 4 y 5.
   - La capa HTTP exporta `AuthenticationRequiredError`, `PermissionDeniedError` y
     `RequestValidationError`, así que se pueden tratar igual. `INTERNAL_ERROR` sale de un `Error`
     cualquiera pasado al handler y `ROUTE_NOT_FOUND` ya lo ejercita `error-examples.test.ts`.
     Las clases base `InvalidValueError`/`BusinessRuleViolationError` se instancian directamente y
     así queda cubierto el Major 1.
   - Límite (aplica a ambos enfoques): ninguno prueba qué ruta declara qué código. Eso sigue
     dependiendo de los tests HTTP por ruta.
     Es un cambio solo de tests (tester). Cambia la forma que pedía el paso 5, así que la sesión
     principal debe registrarlo como desviación.

**Low**

7. Historial del plan: la lista de archivos del paso 5 se amplió después de la aprobación con
   `access.contract.test.ts`, `authorization.test.ts` y `error-examples.test.ts` (diff del plan contra
   `5567936`), pero ninguna desviación dice quién lo hizo ni por qué, y la desviación 1 sigue
   diciendo "fuera de la lista de archivos". Hay que corregir el texto; el código no cambia.
8. `INVALID_VALUE`: el mensaje del ejemplo, `Valor inválido` (`errors.ts:73`), no existe en el
   código (`InvalidValueError` no tiene mensaje por defecto; cada uso pasa el suyo). Ninguna ruta lo
   declara. **Incierto** si es alcanzable por HTTP: los contratos repiten las validaciones del
   dominio (`TaxId.isValid`, `NationalId.isValid`, `PersonalRfc.isValid`, `isSiteTimeZone`), así que
   en las rutas revisadas Zod responde 400 antes. Bastaría con usar un mensaje real como ejemplo.
9. Las recetas `.claude/skills/new-use-case/SKILL.md:15` y `new-module/SKILL.md:20` no mencionan
   que `defineRoute` ahora exige `description` ni que un código nuevo va a `API_ERRORS` y a las
   `errors` de su ruta. No dicen nada falso: el typecheck exige `description` y el test de deriva
   exige el catálogo, pero nada obliga a declarar `errors` por ruta. Conviene una línea en cada una
   (archivos fuera de la lista del plan).

Sin hallazgos en el generador (`openapi.ts`): los 400/401/403 derivados, la agrupación por status
ordenada, el `throw` ante un status ya derivado, los ejemplos solo por `$ref`, el `default` → 500 y
las descripciones de parámetros son correctos, y los cubre `openapi.test.ts`.

Resultado: hay hallazgos que piden cambios en el código (1, 2, 3, 4, 5, 6 y opcionalmente 8, 9).
El status sigue en `review`. Los 1–5 y 8 son de producto (contracts) y van al implementer; el 6 es
solo de tests y va al tester.

### Repair round 1 (main session, 2026-10-03)

Status → `implementing`. Instructions for the implementer (product, contracts):

- **1:** add `BUSINESS_RULE_VIOLATION` (422) to `API_ERRORS` with the real hire-date message of
  `employee.ts:73-79` as example; declare it in `registerEmployee`. Correct Deviation 4.
- **2, 3, 8:** fix the `VALIDATION_ERROR` example (include `pattern` as the API returns it for a
  bad UUID), the `ROUTE_NOT_FOUND` example (`No existe GET /api/v1/…`) and the `INVALID_VALUE`
  example (a message that exists in the code; if none can reach HTTP, say so in its description).
- **4, 5 — same code, different body by module:** a catalogue entry may carry more than one
  example: `examples: { default: ApiErrorBody, [variant: string]: ApiErrorBody }`. A route
  declares a plain code (uses `default`) or `{ code, variant }`. The generator emits
  `components.examples.<CODE>` and `components.examples.<CODE>__<variant>` once each and the
  route references the one it declared. Use variants for `COMPANY_INACTIVE` (identity
  `assignRole`, `identity/domain/errors.ts:103-108`) and `EMPLOYEE_NOT_FOUND` (identity, no
  `details`, `:140-146`); check the other shared codes (`COMPANY_NOT_FOUND`, `SITE_NOT_FOUND`,
  `SITE_INACTIVE`) the same way.
- **7:** record in Deviations that step 5's file list was widened after approval
  (`access.contract.test.ts`, `authorization.test.ts`, `error-examples.test.ts`) and update
  Deviation 1.
- **9:** out of this plan's file list → recipes updated in a follow-up (noted for the user).

Then the tester: **6** — replace the source-as-text `error-catalog.test.ts` by the reviewer's
alternative (import the `errors.ts` modules, instantiate every exported `DomainError` subclass and
the base `InvalidValueError`/`BusinessRuleViolationError`, run them through the real
`errorHandler`, compare status/code/`details` keys with the catalogue, including variants), record
it as a deviation of step 5; promote the two `it.fails` of `error-examples.test.ts` to `it`.

## Verification
