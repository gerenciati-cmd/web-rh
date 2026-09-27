# platform-desarrollo-local — Safe and reproducible local development

## Goal

Harden the existing local infrastructure, make its images reproducible, repair bootstrap configuration handling, and drain API requests before shutdown. Preserve the current host-based application development workflow and validate changes on GitHub-hosted CI runners without a deployment server.

## Plans

| Plan                                        | Title                                      | Depends on | Purpose                                                                                          |
| ------------------------------------------- | ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------ |
| [001](001-seguridad-bootstrap-y-apagado.md) | Local infrastructure, API lifecycle and CI | —          | Loopback ports, pinned images, configured bootstrap and bounded graceful shutdown and CI checks. |

## Dependency notes

None. This delivery does not depend on identity or a production server.

## Decisions with the user

1. (2026-09-26) Address the security concerns identified in the audit, excluding authentication and authorization; those belong to future modules. This delivery scopes security to local infrastructure port exposure.
2. (2026-09-26) Fix API shutdown, image version pinning and bootstrap configuration handling.
3. (2026-09-26) Initially deferred CI workflows; superseded by decision 6.
4. (2026-09-26) Production deployment work is deferred until a server is available.
5. (2026-09-26) The user raised local verification as useful. The proposed implementation documents existing commands; it does not introduce automatic hooks or additional tooling.

6. (2026-09-26) The user explicitly requested relevant CI for the project and development. Include GitHub Actions for quality, real PostgreSQL integration/migration checks and Docker builds. Production deployment remains deferred.

## Delivered

Pending implementation and verification.

## Considered and discarded

- CD, production Compose, production secrets, backups and worker deployment probes: deferred by scope, not rejected permanently. CI is included per decision 6.
- Framework/package upgrades and changes to Money: outside the selected audit items.
- Automatic execution of the full suite on every commit: not requested; keep local checks explicit.
