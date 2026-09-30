# platform-desarrollo-local — Safe and reproducible local development

## Goal

Harden the existing local infrastructure, make its images reproducible, repair bootstrap configuration handling, and drain API requests before shutdown. Preserve the current host-based application development workflow and validate changes on GitHub-hosted CI runners without a deployment server.

## Plans

| Plan                                        | Title                                      | Depends on | Purpose                                                                                          |
| ------------------------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| [001](001-seguridad-bootstrap-y-apagado.md) | Local infrastructure, API lifecycle and CI | —          | Loopback ports, pinned images, configured bootstrap and bounded graceful shutdown and CI checks. |
| [002](002-reset-de-bases-locales.md)        | `pnpm db:reset` for dev and test databases | —          | Sanctioned drop/recreate/migrate(/seed) of local databases; agents limited to the test database. |

## Dependency notes

None. This delivery does not depend on identity or a production server.

## Decisions with the user

1. (2026-09-26) Address the security concerns identified in the audit, excluding authentication and authorization; those belong to future modules. This delivery scopes security to local infrastructure port exposure.
2. (2026-09-26) Fix API shutdown, image version pinning and bootstrap configuration handling.
3. (2026-09-26) Initially deferred CI workflows; superseded by decision 6.
4. (2026-09-26) Production deployment work is deferred until a server is available.
5. (2026-09-26) The user raised local verification as useful. The proposed implementation documents existing commands; it does not introduce automatic hooks or additional tooling.

6. (2026-09-26) The user explicitly requested relevant CI for the project and development. Include GitHub Actions for quality, real PostgreSQL integration/migration checks and Docker builds. Production deployment remains deferred.
7. (2026-09-29) The user requested a command to clean both the local development and test databases (after stale `CL` companies broke `pnpm bootstrap`). Agents may reset only `rrhh_test` without confirmation; the development database requires the user to type its name in an interactive terminal.
8. (2026-09-29) Resetting the development database re-runs the seed by default; `--no-seed` leaves it empty. The test database is never seeded.
9. (2026-09-29) The reset drops and recreates the database (`DROP … WITH (FORCE)` + `CREATE`) and redeploys migrations, rather than truncating tables, so schema drift is also cleared.
10. (2026-09-29) `prisma migrate reset`, `db push` and destructive psql remain blocked; `pnpm db:reset` is the only sanctioned rebuild path.

## Delivered

Pending implementation and verification.

## Considered and discarded

- CD, production Compose, production secrets, backups and worker deployment probes: deferred by scope, not rejected permanently. CI is included per decision 6.
- Framework/package upgrades and changes to Money: outside the selected audit items.
- Automatic execution of the full suite on every commit: not requested; keep local checks explicit.
- `prisma migrate reset` as the reset mechanism (plan 002): already banned, seeds implicitly, and would need a hook exception for every spelling.
- `TRUNCATE` of all tables as the reset (plan 002): keeps schema drift; rejected by decision 9.
