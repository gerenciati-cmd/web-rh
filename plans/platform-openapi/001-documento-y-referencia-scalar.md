---
status: testing
module: platform
min_implementer: mid
depends_on: []
---

# 001 — OpenAPI document from contracts + Scalar reference outside production

## Context

Recon baseline: `c8907a7`, 2026-09-29. Implements README decisions 1–5.

What exists today:

- `packages/contracts/src/http.ts:9-19` defines `RouteDefinition`: `method`, Express-style
  `path` (`:param`), `summary`, optional `params`/`query`/`body` Zod schemas, `response`, and
  `successStatus` (200/201/204). `packages/contracts/src/index.ts:53-57` exports `apiRoutes`, the
  catalogue of every route grouped by module (`organization`, `employees`, `identity`). This is
  everything an OpenAPI document needs; no annotations are missing.
- Schema shapes to handle: `packages/contracts/src/common.ts:5-9` (`ApiErrorSchema`, the single
  error body), `:12-15` (`PageQuerySchema` with `z.coerce.number()` and defaults), `:19-25`
  (`pageOf`). `packages/contracts/src/organization/company.contract.ts:19-29` uses `.refine`
  (not representable in JSON Schema; it is dropped, which is acceptable).
  `packages/contracts/src/identity/auth.contract.ts:44` declares the logout response as
  `z.undefined()` with `successStatus: 204` (`:45`).
- Zod `4.6.5` (`pnpm-workspace.yaml:28`) exports a native `toJSONSchema`
  (`packages/contracts/node_modules/zod/v4/classic/external.d.ts:11`). Vitest exposes
  `toMatchFileSnapshot` (`packages/contracts/node_modules/vitest/dist/index.d.ts`), and
  `packages/contracts/package.json:14` runs `vitest run` inside `pnpm check`.
- API wiring: `apps/api/src/http/app.ts:15` sets `API_PREFIX = '/api/v1'`. `:23` applies
  `helmet()` with its default Content-Security-Policy. `:50-57` mounts the authenticate
  middleware and module routers under the prefix. `apps/api/src/config/env.ts:10` defines
  `NODE_ENV` (`development | test | production`). `apps/api/src/http/bind-route.ts:58` already
  gates dev-only behaviour on `NODE_ENV !== 'production'`.
- Authentication, which decides how "probar los logins" works:
  - `apps/api/src/http/authenticate.ts:85-90` accepts `Authorization: Bearer <token>` without
    any origin check.
  - With a cookie (`__Host-rrhh_session`, `apps/api/src/http/request-context.ts:4`), mutating
    requests are authenticated only if `Origin` is in `CORS_ORIGINS` (`authenticate.ts:105-112`).
    `apps/api/.env.example:6` lists only the web and Expo origins, not the API's own
    `http://localhost:3001`. A cookie login from the Scalar page therefore works for `GET`s,
    but a cookie-authenticated `POST /auth/logout` from that page is anonymous.
  - `auth.contract.ts:19,26-29`: `client: 'mobile'` returns the token in the body, which is
    the Bearer flow.
  - Both flows are supported (README decision 5). For the cookie flow, the development value
    of `CORS_ORIGINS` gains the API's own origin `http://localhost:3001`, where Scalar is
    served. This is a configuration value, not a rule change: the Origin check at
    `authenticate.ts:105-112` stays exactly as is. It only trusts one more local origin in
    development. The docs page is same-origin with the API, so CORS itself is unaffected.
- Scalar (verified at scalar.com, Express integration, 2026-09-29):
  `import { apiReference } from '@scalar/express-api-reference'`, then
  `app.use(path, apiReference({ url | content, cdn? }))`. It renders an HTML page that loads its
  bundle from a CDN, so helmet's default CSP (`script-src 'self'`) would block it. Latest
  version `0.10.24` (`pnpm view`). No other option of the package was verified; do not use
  undocumented options.

Approaches considered:

- (a) A second schema layer (`zod-openapi` / `express-zod-api`). This duplicates the contracts
  and is discarded in the README.
- (b) Chosen: a pure generator in `@rrhh/contracts` that walks `apiRoutes` and converts each
  schema with `z.toJSONSchema`. The committed `packages/contracts/openapi.json` is guarded by a
  Vitest file snapshot, so `pnpm check` fails when it is stale and `vitest -u` regenerates it.
  This needs no new tooling in `pnpm check`. The API serves the same builder output at runtime,
  plus Scalar, only outside production.

Test style imitates `packages/contracts/src/organization/company.contract.test.ts`. The router
factory shape imitates `apps/api/src/http/health.router.ts` (`createHealthRouter({ … })`, used
at `app.ts:44`).

## Out of scope

- Any change to authentication logic, the CSRF/Origin check code, cookies or sessions. The only
  auth-adjacent change is the development `CORS_ORIGINS` value in step 4.
- Editing the user's real `apps/api/.env` (agents cannot; the user adds the origin by hand).
- Exposing the docs in production (a future plan, once RBAC exists).
- Documenting the ZKTeco device routes (`/iclock/*`, ADR 0008). They are not contracts.
- Per-route security requirements (the contracts don't declare which routes need a session). A
  global optional security block is used instead.
- Examples, tags beyond the module grouping, response descriptions per error code.
- Web/mobile changes; `@rrhh/api-client` changes.
- No commits without user authorization.

## Dependencies

None.

## Steps

1. **Pure OpenAPI builder in contracts.**
   - Files: `packages/contracts/src/openapi.ts` (create), `packages/contracts/src/index.ts` (modify)
   - Export `buildOpenApiDocument(routes = apiRoutes)` returning a plain object (OpenAPI
     `3.1.0`). `info.title: 'API RRHH APS Holding'`, `info.version: '1'`,
     `servers: [{ url: '/api/v1' }]`.
   - For each `[module, group]` of the catalogue and each `[operationId, route]`:
     - Path: convert `:name` segments to `{name}`. Method: lower case. `operationId`: the
       route key (`listCompanies`). `summary`: `route.summary`. `tags: [module]`.
     - `params` / `query`: they are `z.object`s. Emit one `parameters` entry per property
       (`in: 'path'` with `required: true`, or `in: 'query'` with `required` from the JSON
       Schema `required` array). Each entry's `schema` is that property's JSON Schema.
     - `body`: `requestBody.required: true`, `content['application/json'].schema`.
     - Success response: key `String(route.successStatus ?? 200)`. For 204, no `content`.
       Otherwise `content['application/json'].schema`. `description: route.summary`.
     - Error responses `400`, `401`, `404`, `409`, `500` referencing
       `#/components/schemas/ApiError`, built from `ApiErrorSchema` (`common.ts:5`).
   - Conversion: call `z.toJSONSchema(schema, { io, unrepresentable: 'any' })` with
     `io: 'input'` for params/query/body and `io: 'output'` for responses (the document
     describes what clients send and receive). Drop the top-level `$schema` key from each
     result. If the installed Zod rejects an option name, read
     `packages/contracts/node_modules/zod/v4/core/json-schema-processors.d.ts` and use the
     equivalent. Record it in Deviations.
   - `components.securitySchemes`: `bearerAuth` (`type: http`, `scheme: bearer`, description
     in Spanish explaining the `client: "mobile"` login), and `cookieAuth` (`type: apiKey`,
     `in: cookie`, `name: '__Host-rrhh_session'`). Top-level
     `security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}]`.
   - Must stay pure (no IO) and importable by the API. Re-export from `index.ts`.
   - Observable result: `buildOpenApiDocument()` contains every route of `apiRoutes` (8 today)
     under its converted path.

2. **Committed document guarded by a file snapshot.**
   - Files: `packages/contracts/src/openapi.test.ts` (create), `packages/contracts/openapi.json` (create), `packages/contracts/package.json` (modify)
   - Test: `await expect(JSON.stringify(buildOpenApiDocument(), null, 2) + '\n')
.toMatchFileSnapshot('../openapi.json')`. Add a script `"openapi": "vitest run src/openapi.test.ts -u"`
     to regenerate. Generate the file once by running it. The tester adds the behavioural tests.
   - Observable result: changing a contract without running
     `pnpm --filter @rrhh/contracts openapi` makes `pnpm check` fail. After running it,
     `git diff packages/contracts/openapi.json` shows the change.

3. **Serve the document and Scalar outside production.**
   - Files: `apps/api/package.json` (modify, via `pnpm --filter @rrhh/api add @scalar/express-api-reference@0.10.24`), `apps/api/src/http/docs.router.ts` (create), `apps/api/src/http/app.ts` (modify)
   - `createDocsRouter()` returns a `Router` with `GET /openapi.json` (responds with
     `buildOpenApiDocument()`, computed once at creation) and `use('/docs', apiReference({ url:
'/api/v1/openapi.json' }))`.
   - CSP: before writing it, find the CDN host the installed version loads (search
     `node_modules/@scalar/express-api-reference/dist` for `cdn`/`https://`). Mount the docs
     router with a route-scoped `helmet.contentSecurityPolicy` whose `script-src` adds exactly
     that host plus `'unsafe-inline'`, keeping helmet's other defaults. If the page needs more
     sources (styles, fonts), add only the hosts observed as blocked in the browser console, and
     list each in Deviations. Global `helmet()` for the rest of the app is unchanged.
   - In `app.ts`, register `app.use(API_PREFIX, createDocsRouter())` only when
     `env.NODE_ENV !== 'production'`. Register it before the authenticated API router (`:50`),
     so docs requests skip the authenticate middleware.
   - Observable result: with `pnpm dev:api`, `http://localhost:3001/api/v1/docs` renders the
     reference and `/api/v1/openapi.json` returns the document. With `NODE_ENV=production`,
     both return 404.

4. **Development origin for the cookie flow.**
   - Files: `apps/api/.env.example` (modify)
   - Append `,http://localhost:3001` to `CORS_ORIGINS` (`:6`), keeping the existing origins and
     their order. Only the example file changes. The user adds the same value to their own
     `apps/api/.env`. The implementer reports that manual step to the user and never reads or
     edits `.env`.
   - Observable result: a fresh `.env` copied by `pnpm bootstrap` supports the cookie login from
     Scalar.

5. **Developer docs.**
   - Files: `README.md` (modify), `docs/conventions.md` (modify)
   - `README.md` "Comandos habituales": add `pnpm --filter @rrhh/contracts openapi   # regenera
openapi.json tras cambiar un contrato` and a line pointing to `http://localhost:3001/api/v1/docs`.
   - `docs/conventions.md`: in the contracts section, one short paragraph. Changing a contract
     requires regenerating `openapi.json` (`pnpm check` enforces it). The reference supports
     two login flows. `client: "web"` uses the cookie, which requires
     `http://localhost:3001` in `CORS_ORIGINS`. `client: "mobile"` returns a token to paste
     into Bearer.
   - Observable result: `pnpm format:check` passes.

6. **Repair round 1 (2026-09-30, README decision 6): dedup, pinned CDN, review findings.**
   - Files: `packages/contracts/src/openapi.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/common.ts` (modify), `packages/contracts/src/organization/company.contract.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/src/identity/auth.contract.ts` (modify), `apps/api/src/http/docs.router.ts` (modify), `.prettierignore` (modify), `apps/api/tests/docs.test.ts` (create), `packages/contracts/src/openapi.test.ts` (modify)
   - Name the models with `.meta({ id })` in their contracts: `ApiError`, `Created`, `Company`,
     `CreateCompanyInput`, `EmployeeListItem`, `RegisterEmployeeInput`, `SessionUser`,
     `LogInInput`, `LogInResponse`. Query and params schemas stay unnamed (they are expanded
     into parameters).
   - Builder: hoist each conversion's `$defs` into `components.schemas` and rewrite
     `#/$defs/X` to `#/components/schemas/X`. Throw a clear error if a hoisted id already exists
     with a different JSON (the same name with two shapes, e.g. input vs output io), or if a
     def has no explicit id (Zod's anonymous `__schemaN`). This fixes review finding 2. Replace
     the five per-operation error responses with one `components.responses.Error` referenced
     as `default`. Throw on two operations with the same method and path (review finding 3).
   - `docs.router.ts`: pin `cdn` to `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.2`,
     the version observed rendering without CSP errors during verification (Deviation 6).
   - `.prettierignore` and `apps/api/tests/docs.test.ts` are listed here to close review
     finding 1. The CSP assertion (finding 4) belongs to the tester.
   - Observable result: `openapi.json` much shorter, with `$ref`s to named models; Scalar lists
     the models; `pnpm check` green.

## Acceptance criteria

- [ ] `GET http://localhost:3001/api/v1/openapi.json` (dev) returns an OpenAPI 3.1 document with
      the 8 contract routes, path params in `{}` form, and `ApiError` in components.
- [ ] `http://localhost:3001/api/v1/docs` renders Scalar in the browser with no CSP errors in the
      console.
- [ ] From Scalar: `POST /auth/login` with a seeded user and `client: "mobile"` returns 200 with
      `token`. With that token set in `bearerAuth`, `GET /auth/me` returns 200 with the user and
      `POST /auth/logout` returns 204. The same `GET /auth/me` without a token returns 401.
- [ ] From Scalar, with `http://localhost:3001` in the local `CORS_ORIGINS`: `POST /auth/login`
      with `client: "web"` sets the session cookie. `GET /auth/me` then returns 200, and
      `POST /auth/logout` returns 204 and ends the session (the next `/auth/me` returns 401). If
      the browser rejects the `__Host-` Secure cookie over `http://localhost`, record it as NOT
      VERIFIED with the browser and version. Do not change cookie options.
- [ ] From Scalar: `GET /companies` lists the seeded companies. `POST /companies` with an invalid
      tax id returns 400 with the `ApiError` shape.
- [ ] With `NODE_ENV=production`, `/api/v1/docs` and `/api/v1/openapi.json` return 404.
- [ ] Editing a contract `summary` without regenerating makes `pnpm check` fail. Running
      `pnpm --filter @rrhh/contracts openapi` fixes it.
- [ ] `pnpm check` passes; `pnpm arch:check` shows no new violations.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | no      |                                                                                                                                           |
| application | no      |                                                                                                                                           |
| contract    | yes     | `openapi.test.ts`: every `apiRoutes` entry present, path conversion, parameters from params/query, 204 without content, security schemes. |
| http        | yes     | `apps/api/tests/`: `/api/v1/openapi.json` 200 and `/api/v1/docs` 200 HTML outside production; both 404 with production env.               |
| integration | no      |                                                                                                                                           |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                               |

## Deviations

Implemented 2026-09-30, inline in the main session. Zod's `toJSONSchema` options (`io`,
`unrepresentable`) exist as planned (`zod/v4/core/to-json-schema.d.ts:34,44`).

1. **Step 1, builder signature.** The plan had `buildOpenApiDocument(routes = apiRoutes)`.
   The implementation is `buildOpenApiDocument(routes)` with a required argument, and callers
   pass `apiRoutes`. A default would force `openapi.ts` to import `index.ts`, which
   re-exports `openapi.ts`: a circular import. Cosmetic.
2. **Step 2, `.prettierignore` (file not listed in the plan).** `JSON.stringify(…, 2)` and
   Prettier format arrays differently. `prettier --check` rejected the generated file, and a
   Prettier pass breaks the snapshot. Following the existing pattern for generated files
   (`**/generated/**`, harness adapters), `packages/contracts/openapi.json` was added to
   `.prettierignore`. Without this, `pnpm check` cannot be green. This happened once during
   implementation: the file got Prettier-formatted before the ignore entry existed, the
   snapshot test failed as designed, and `pnpm --filter @rrhh/contracts openapi` regenerated
   it.
3. **Step 3, Scalar version `0.10.23` instead of `0.10.24`.** `0.10.24` and its 4 `@scalar/*`
   dependencies were published 2026-09-29 09:36 UTC, inside pnpm's minimum release age. pnpm
   auto-added them to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. That exception was
   removed. `0.10.23` (2026-09-25) installs with no exception, so `pnpm-workspace.yaml` is
   unchanged.
4. **Step 3, CSP uses a per-request nonce instead of `'unsafe-inline'`.** The installed
   `@scalar/client-side-rendering` supports `nonce`. With it, the page loads the UMD bundle
   from `https://cdn.jsdelivr.net/npm/@scalar/api-reference` (`DEFAULT_CDN`) plus a nonced
   inline init script. `script-src` is `'self' https://cdn.jsdelivr.net 'nonce-<random>'`.
   `upgradeInsecureRequests` is disabled for this page only: on `http://localhost` it would
   rewrite the reference's "try it" requests to https. Helmet's other defaults are kept. The
   nonce uses `node:crypto` `randomBytes` directly, like `app.ts:1,29` does for request ids.
5. **Step 3, router signature.** `createDocsRouter({ openApiUrl })` instead of
   `createDocsRouter()`. The spec URL depends on `API_PREFIX`, which lives in `app.ts`, and
   importing it from the router would be circular. The route is typed
   `router.get<never, string>` to match Scalar's `RequestHandler<never, string>` without
   casts.
6. **Observation, not changed: the CDN bundle is unpinned.** Scalar's default CDN URL has no
   version, so the page loads the latest `@scalar/api-reference` at runtime. This is dev-only
   (not served in production). Pinning via the `cdn` option needs a known-compatible
   version, which was not verified.

Observable results checked:

- `pnpm dev:api` gives `GET /api/v1/openapi.json`: `200 application/json`.
  `GET /api/v1/docs`: `200 text/html`, CSP
  `script-src 'self' https://cdn.jsdelivr.net 'nonce-…'` with no `upgrade-insecure-requests`,
  and both `<script>` tags carry the same nonce.
- `openapi.json`: 8 operations, path params as `{companyId}`, pagination query params with
  defaults, `logOut` 204 without content, `ApiError` and both security schemes in components.
- `pnpm check`: `Tasks: 19 successful`, arch `no dependency violations (156 modules)`,
  harness 161/161, bootstrap 17/17, quality 9/9.
- `pnpm plans:scope … --base origin/main`: `.prettierignore` is out of scope (deviation 2).
  `packages/contracts/src/index.ts` is a hot file with an append-only addition.
- Not exercised by the implementer: rendering in a browser, the login flows and the production 404. These belong to the tester (http layer) and the verifier. The cookie flow also needs
  the user to add `http://localhost:3001` to their own `apps/api/.env` `CORS_ORIGINS`.

### Repair round 1 (2026-09-30)

Reason: after the PASS verification, the user asked to pin the CDN version, fix the review
findings and reduce the document size (README decision 6). Status went verify → implementing.
The previous Test coverage, Review findings and Verification entries remain as history. They
**do not cover** the code below; a new tests → review → verify cycle follows (step 6).

- **Dedup.** Nine models are named with `.meta({ id })` in their contracts (`common.ts`,
  `company.contract.ts`, `employee.contract.ts`, `auth.contract.ts`). `toSchema` hoists Zod's
  `$defs` into `components.schemas` (sorted by key for a stable file) and rewrites
  `#/$defs/X` to `#/components/schemas/X`. `openapi.json` went from **1119 to 713 lines**.
  Operations now reference `Company`, `CreateCompanyInput`, `Created`, `EmployeeListItem`,
  `RegisterEmployeeInput`, `LogInInput`, `LogInResponse` and `SessionUser`.
- **Errors.** The 5 per-operation error responses (40 copies) became one
  `components.responses.Error`, referenced as `default`. **Behaviour change vs plan step 1**
  (which listed 400/401/404/409/500 per operation): `default` is also more accurate, since not
  every route can return every code. The Error description lists the codes.
- **Finding 2.** A `$def` without an explicit id (`__schemaN`) throws. The same id with two
  different JSON shapes throws. A params/query schema carrying an id (which would silently
  drop parameters) throws.
- **Finding 3.** A duplicate method+path throws instead of overwriting.
- **Finding 1.** `.prettierignore` and `apps/api/tests/docs.test.ts` are now listed in step 6.
- **Deviation 6 closed.** `cdn` is pinned to `@scalar/api-reference@1.72.2`. Live check:
  `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.2"`. Headless Chrome
  console shows `"@scalar/api-reference@1.72.2"` and 0 CSP/"Refused" lines. The DOM shows the
  "Models" section.
- `docs/conventions.md`: model naming rule added (bodies named, params/query not).
- **Checks.** Contracts/api typecheck+lint green. Web and mobile typecheck green (contracts
  changed). `@rrhh/api` 184/184. `arch:check` clean.
  **`@rrhh/contracts`: 1 failing test**, `cada operación referencia ApiError en los códigos de
error declarados`, which asserts the removed 5-code shape. It is a test-only correction for
  the tester (role purity), together with finding 4 (CSP assertion) and tests for the new
  throws.

## Test coverage

Tested 2026-09-30. Baseline `pnpm check` (before writing tests): green, 19/19 tasks, `@rrhh/api`
180 tests, `@rrhh/contracts` 32 tests. Closing `pnpm check`: green, 19/19 tasks, `@rrhh/api` 184
tests (25 files), `@rrhh/contracts` 41 tests (5 files), `arch:check` no dependency violations
(156 modules), `plans:lint` clean. Files added: `packages/contracts/src/openapi.test.ts`
(9 tests, behavioural `describe('buildOpenApiDocument', …)` added to the implementer's snapshot
test), `apps/api/tests/docs.test.ts` (4 tests, new file). No product code touched.

| Behavior (from plan / code)                                                                                                           | Source (`file:line`)                                 | Layer    | Test                                                                          | State         |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------- | ----------------------------------------------------------------------------- | ------------- |
| `openapi.json` stays in sync with `apiRoutes` (regenerated by the implementer)                                                        | `openapi.ts`, `openapi.json`                         | contract | `openapi.test.ts › openapi.json está al día con los contratos` (pre-existing) | CONFIRMED     |
| Every `apiRoutes` entry (8) becomes one operation, keyed by its route key                                                             | `openapi.ts:20-27` (loop over `routes`)              | contract | `openapi.test.ts › incluye una operación por cada ruta de las 3 catálogos…`   | CONFIRMED     |
| Express `:param` path segments convert to OpenAPI `{param}`                                                                           | `openapi.ts:24`                                      | contract | `openapi.test.ts › convierte los segmentos :param…`                           | CONFIRMED     |
| `params` schema properties become required `in: 'path'` parameters                                                                    | `openapi.ts:59,103-113`                              | contract | `openapi.test.ts › emite un parámetro path…`                                  | CONFIRMED     |
| `query` schema properties become `in: 'query'` parameters (required from JSON Schema)                                                 | `openapi.ts:60,103-113`                              | contract | `openapi.test.ts › emite parámetros query desde PageQuerySchema…`             | CONFIRMED     |
| A `successStatus: 204` response has no `content`                                                                                      | `openapi.ts:65-69` (`logOut`, `auth.contract.ts:45`) | contract | `openapi.test.ts › logOut (204) no lleva content…`                            | CONFIRMED     |
| A success response with a body has `content['application/json'].schema`                                                               | `openapi.ts:70-73` (`logIn`)                         | contract | `openapi.test.ts › las respuestas de éxito con cuerpo sí llevan content…`     | CONFIRMED     |
| `components.securitySchemes` declares `bearerAuth` and `cookieAuth`; `ApiError` in `components.schemas`; top-level `security` block   | `openapi.ts:37-51`                                   | contract | `openapi.test.ts › declara los dos esquemas de seguridad y ApiError…`         | CONFIRMED     |
| Every operation references `#/components/schemas/ApiError` for 400/401/404/409/500                                                    | `openapi.ts:16,83-92`                                | contract | `openapi.test.ts › cada operación referencia ApiError…`                       | CONFIRMED     |
| `GET /api/v1/openapi.json` returns 200 with the document, outside production, no session required                                     | `docs.router.ts:20-22`, `app.ts:44-46`               | http     | `docs.test.ts › GET /api/v1/openapi.json responde 200…`                       | CONFIRMED     |
| `GET /api/v1/docs` returns 200 HTML, outside production, no session required                                                          | `docs.router.ts:25-40`, `app.ts:44-46`               | http     | `docs.test.ts › GET /api/v1/docs responde 200 con HTML…`                      | CONFIRMED     |
| With `NODE_ENV=production`, `/api/v1/openapi.json` returns 404                                                                        | `app.ts:44` (`if (env.NODE_ENV !== 'production')`)   | http     | `docs.test.ts › con NODE_ENV=production, /api/v1/openapi.json responde 404`   | CONFIRMED     |
| With `NODE_ENV=production`, `/api/v1/docs` returns 404                                                                                | `app.ts:44`                                          | http     | `docs.test.ts › con NODE_ENV=production, /api/v1/docs responde 404`           | CONFIRMED     |
| CSP nonce on `/docs` allows the Scalar CDN bundle with no console CSP errors                                                          | `docs.router.ts:27-37`                               | e2e      | not exercisable without a real browser; belongs to the verifier               | NOT CONFIRMED |
| Login flows through the Scalar UI (mobile Bearer, web cookie), `GET /companies` listing, 400 on invalid tax id from the rendered page | acceptance criteria (interactive)                    | e2e      | needs a running app + browser, not unit/http-testable                         | NOT CONFIRMED |

Not exercised here (interactive/browser acceptance criteria, explicitly the verifier's job per
the plan and `tester.md`'s layer table — this plan only requires contract + http): rendering
Scalar in a browser with no CSP console errors, the four login/listing flows performed through
the rendered Scalar page, and the cookie flow's dependency on the user's own `apps/api/.env`
`CORS_ORIGINS`. No GAP found: the http/contract layers behave exactly as the plan and code
describe; nothing promised by the plan is missing from the implementation at these layers.

## Review findings

Reviewed 2026-09-30 (Reviewer subagent). Diff: `git diff origin/main...HEAD` (commits `5fd9348`,
`f9ea577`; the merge of `origin/main` with plan 002 is excluded). Working tree clean.

### Pass 1 — Checklist: 12/13 (1 procedural failure, no code change needed)

- [ ] `pnpm plans:scope … --base origin/main`: **fails**. Out of scope: `.prettierignore`
      (disclosed in Deviation 2, justified: without it `pnpm check` cannot be green) and
      `apps/api/tests/docs.test.ts` (the tester's http test required by "Test layers required",
      but the path is not in any step's file list). `packages/contracts/src/index.ts` (hot
      file): the change is one appended `export * from './openapi'`, append-only. `pnpm-lock.yaml`
      only adds the `@scalar/*` 0.10.23 tree (no 0.10.24, `pnpm-workspace.yaml` unchanged).
- [x] `pnpm check` passes: `Tasks: 19 successful, 19 total`, `@rrhh/api` 184 tests (25 files,
      `tests/docs.test.ts` 4), arch `no dependency violations found (156 modules)`,
      `harness:check — 24 adaptadores al día`, bootstrap 17/17, quality 9/9.
- [x] `infrastructure/` not touched: integration tests N/A.
- [x] No business rules added (pure generator in contracts; router only wires HTTP).
- [x] CQRS-lite: N/A (no commands/queries).
- [x] Types come from `@rrhh/contracts` (`RouteDefinition`, `apiRoutes`, `ApiErrorSchema`);
      the document is derived, nothing hand-duplicated.
- [x] Errors: N/A for new endpoints; CSP middleware error is forwarded via `next(error)`.
- [x] Money/dates/Clock/IdGenerator: N/A. The nonce uses `node:crypto` like the request id.
- [x] No schema change.
- [x] No DI registrations added; `tests/container.test.ts` green.
- [x] No secrets, `.env` contents or personal data. `.env.example` only gains a local origin.
- [x] `## Deviations` exists and is honest. Spot-checked: Deviation 5
      (`createDocsRouter({ openApiUrl })`, `docs.router.ts:19`, called at `app.ts:50`) and Deviation 3
      (`apps/api/package.json` pins `0.10.23`, lockfile has no 0.10.24, no workspace diff) and
      Deviation 4 (installed `@scalar/client-side-rendering@0.4.5` `html-rendering.js:183,196-200`:
      with a `nonce` it emits the UMD `<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference">`
      plus a nonced inline init script, matching the CSP in `docs.router.ts:31`).
- [x] Docs updated: `README.md` and `docs/conventions.md` (contracts section). `docs/architecture.md`
      has no mention of HTTP docs/CSP that became stale.

### Pass 2 — Bug hunt

No Critical/High/Medium findings. Traced: `apiRoutes` → `buildOpenApiDocument` (`openapi.ts:19-55`)
→ `openapi.json` snapshot and `GET /api/v1/openapi.json` (`docs.router.ts:23-25`); `GET /api/v1/docs`
→ route-scoped helmet CSP (overrides the global header via `setHeader`) → Scalar HTML. Mounted
at `app.ts:47-51` before the authenticated router, only when `NODE_ENV !== 'production'`.
`openapi.json`: query params use `io: 'input'` (`page`/`pageSize` not required, with defaults),
path params required, no stray `$ref`/`$defs` besides `ApiError`.

**Low**

1. **Procedural: plan file list incomplete** (`plans:scope` item above). No code change: the
   main session should either add `.prettierignore` and `apps/api/tests/docs.test.ts` to the
   plan's file lists or accept them explicitly when committing. Not blocking.
2. **Latent: `$defs`/`$ref` produced by `z.toJSONSchema` would break once hoisted**
   (`openapi.ts:117-123`, `parametersFrom` `:103-113`). Each schema is converted standalone and
   only `$schema` is dropped. If a contract ever uses `.meta({ id })`/a registry or a recursive
   schema, Zod emits `$defs` + `$ref: '#/$defs/…'` inside the fragment; embedded in the document,
   those refs resolve against the document root and break (and `parametersFrom` would drop a
   `$ref`-only param). Not reachable today (no `.meta(`/ids in `packages/contracts/src`, no
   `$defs` in `openapi.json`). Scenario: a future contract adds `.meta({ id: 'Money' })` →
   Scalar shows unresolved refs, the snapshot test still passes.
3. **Latent: operations colliding on the same path+method overwrite silently**
   (`openapi.ts:24-26`). Two catalogue entries with the same `method` + `path` in different
   modules keep only the last one and the "every route present" test would catch it only by
   count. Not reachable today (8 distinct operations).
4. **Test gap (not required by the plan): the CSP on `/docs` is not asserted** (`docs.test.ts:26-32`
   checks only status and content type). A regression that drops the nonce, loosens
   `script-src` or leaks the relaxed CSP to other routes would pass `pnpm check` and only surface
   in verify. Suggest asserting the `content-security-policy` header (nonce present, matches
   the `<script nonce>` in the body, no `upgrade-insecure-requests`) and that `/api/v1/companies`
   keeps the global CSP.

**Info (uncertain, for the verifier)**

5. Helmet's defaults leave `connect-src`/`worker-src` falling back to `default-src 'self'`. If the
   UMD bundle uses `blob:` workers or fetches from other hosts, the browser console will show CSP
   errors (acceptance criterion 2). Not verifiable without a browser.
6. Exposure is fail-open on `NODE_ENV` (`env.ts:10` defaults to `development`). Mitigated by
   `apps/api/Dockerfile:46` (`ENV NODE_ENV=production`) and consistent with the existing
   `bind-route.ts` gate; noted only because a deploy outside that image without `NODE_ENV` would
   publish the API map. Plus Deviation 6: the unpinned CDN bundle runs on the API origin, which
   the development `CORS_ORIGINS` now trusts for cookie-authenticated mutations (dev-only,
   accepted in the plan).

No findings require code changes. Plan to `verify`.

## Verification

**PASS** — 2026-09-30, main session (verifier role), code at `ea950ea`. The API was run by the
user (`pnpm dev:api`, with `http://localhost:3001` added to their `CORS_ORIGINS` and the seed
user created). The user also exercised the flows in their own browser and reported them
working. The evidence below is the verifier's own.

Suites (run once): `pnpm check` gives `Tasks: 19 successful, 19 total`,
`no dependency violations found (156 modules)`, harness `pass 161 / fail 0`, bootstrap
`pass 17 / fail 0`, quality `pass 9 / fail 0`.

Acceptance criteria:

- [x] `GET /api/v1/openapi.json` returns `200`, with 8 operations, `{companyId}` path params
      and `ApiError` in components (curl; shape also covered by the contract tests).
- [x] `/api/v1/docs` in headless Chrome (`google-chrome-stable --headless=new --dump-dom`,
      console logged to stderr). Console:
      `"@scalar/api-reference@1.72.2", source: https://cdn.jsdelivr.net/npm/@scalar/api-reference`.
      **No CSP violation or "Refused" lines**; the only other console lines come from a KDE
      browser extension in the profile. The rendered DOM (367 KB) contains
      `API RRHH APS Holding` and the route summaries.
- [x] Bearer flow (same requests Scalar sends, `Origin: http://localhost:3001`):
      `POST /auth/login` with `client: "mobile"` returns 200 with `token`;
      `GET /auth/me` with the Bearer returns 200 `admin@example.com`; `POST /auth/logout`
      returns 204; `GET /auth/me` with the revoked token returns 401 `AUTHENTICATION_REQUIRED`.
- [x] Cookie flow: `POST /auth/login` with `client: "web"` returns 200, `token: null`, and
      `Set-Cookie: __Host-rrhh_session=…; Path=/; HttpOnly; Secure; SameSite=Lax`. Then
      `GET /auth/me` with the cookie returns 200. `POST /auth/logout` with
      `Origin: http://localhost:3001` returns 204, and the next `GET /auth/me` returns 401.
      Unhappy path: the same logout with `Origin: http://evil.example.com` returns 401 and
      `/auth/me` still returns 200 afterwards, so the CSRF Origin check still rejects foreign
      origins. The browser's handling of a `__Host-`/`Secure` cookie over `http://localhost`
      was reported working by the user (not observed directly by the verifier).
- [x] `GET /companies` lists the 3 seeded companies. `POST /companies` with `taxId: "123"`
      returns 400 `VALIDATION_ERROR` in the `ApiError` shape.
- [~] Production 404: covered by `apps/api/tests/docs.test.ts` (real app built with a
  production `Env`, both routes 404). **NOT VERIFIED live**: launching a second API with
  `NODE_ENV=production PORT=3099` was blocked by the bash guard (multiple inline env
  assignments). Not worked around.
- [x] Stale `openapi.json` makes `pnpm check` fail: observed during implementation
      (Deviation 2: snapshot mismatch until `pnpm --filter @rrhh/contracts openapi`).
- [x] `pnpm check` passes; `arch:check` shows no violations.

Verification data: no rows were created by the verifier. The `admin@example.com` user and its
sessions come from the user's seed. The sessions created by these checks were logged out.
