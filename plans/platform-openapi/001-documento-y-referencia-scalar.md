---
status: draft
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

## Test coverage

## Review findings

## Verification
