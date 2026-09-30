# platform-openapi — OpenAPI document and interactive API reference

## Goal

Give developers an interactive, always-accurate reference of the HTTP API. They can browse
every endpoint, send real requests (including logging in and calling authenticated routes) and
review API changes in pull requests. The OpenAPI document is derived from the Zod contracts in
`@rrhh/contracts`, the single source of truth, so it can never drift from the implementation.

## Plans

| Plan                                        | Title                                           | Depends on | Purpose                                                                                                             |
| ------------------------------------------- | ----------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------- |
| [001](001-documento-y-referencia-scalar.md) | OpenAPI from contracts + Scalar reference (dev) | —          | Pure generator in contracts, committed `openapi.json` checked by `pnpm check`, Scalar UI served outside production. |

## Dependency notes

None.

## Decisions with the user

1. (2026-09-29) The user wants an OpenAPI/Swagger-style interactive environment to exercise API routes as they are added.
2. (2026-09-29) UI: Scalar.
3. (2026-09-29) A generated `openapi.json` is committed and `pnpm check` fails when it is stale, so contract changes are visible in PR diffs.
4. (2026-09-29) The reference must allow testing the login flows ("la idea es también probar los logins"). Plan 001 serves it only outside production (architect's call, pending the user's approval of the plan).
5. (2026-09-29) Both login flows are testable from the reference. The cookie flow is enabled by adding the API's own development origin (`http://localhost:3001`) to `CORS_ORIGINS`. The user confirmed this is a configuration value, not an auth change needing its own plan.

## Delivered

Pending implementation and verification.

## Considered and discarded

- Swagger UI: the user chose Scalar.
- Hand-written OpenAPI annotations or a second schema registry (`zod-openapi`, `express-zod-api`): they duplicate the contracts that already carry method, path, summary and schemas. Zod 4's native `z.toJSONSchema` is enough.
- Generating the document only at runtime: rejected by decision 3.
