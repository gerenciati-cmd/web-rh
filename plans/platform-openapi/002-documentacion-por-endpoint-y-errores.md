---
status: approved
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
   - Files: `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify), `apps/api/tests/error-catalog.test.ts` (create)
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

## Test coverage

## Review findings

## Verification
