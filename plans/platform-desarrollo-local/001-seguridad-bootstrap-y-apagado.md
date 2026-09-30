---
status: done
module: platform
min_implementer: mid
depends_on: []
---

# 001 — Harden local infrastructure, bootstrap, API shutdown and CI

## Context

Recon baseline: `d70cbe0`, 2026-09-26. Implements README decisions 1–6.

- `infra/docker/docker-compose.yml:1` explicitly defines local infrastructure with applications running on the host. Its six published ports omit a host address (`:20`, `:36`, `:55`, `:56`, `:65`, `:66`). Image references are moving major tags (`:12`, `:32`) or latest (`:48`, `:62`).
- `scripts/bootstrap.mjs:45` starts local infrastructure, but `:49` fixes the psql role/database instead of using the container configuration. `:51`–`:55` ensures a fixed `rrhh_test` database. `infra/docker/postgres/01-create-test-db.sql:4` creates that same database only on first initialization.
- `apps/api/tests/integration/test-database-url.ts:11` accepts DATABASE_URL_TEST, otherwise derives a database name by appending `_test` to DATABASE_URL. Custom application configuration therefore needs an explicit DATABASE_URL_TEST pointing at the fixed local test database; bootstrap must not silently rewrite application environment files.
- `apps/api/src/main/http.ts:16` starts server.close without awaiting its callback, disposes the container and exits. The container owns database and queue cleanup (`apps/api/src/container.ts:65`–`:72`).
- Existing HTTP tests use Vitest and Supertest (`apps/api/tests/http.test.ts:1`), and `apps/api/vitest.config.ts:10` includes tests under src and tests. Follow their Spanish test names and the explicit dependency-object style from `apps/api/src/container.ts:55`.
- `package.json:22` already exposes local quality checks; `:39` exposes database integration tests. `README.md:42` describes CI enforcement, but `.github/workflows/README.md:3` confirms there are no active workflows. Decision 6 now authorizes CI.
- `.nvmrc:1` specifies Node 26, while `apps/api/Dockerfile:10` uses Node 24. CI must exercise both supported environments without changing those declarations. `apps/api/tests/integration/global-setup.ts:6` deploys migrations before integration tests, and `apps/api/prisma.config.ts:18` allows generation without a database URL.
- `.github/workflows/README.md:7`–`:14` outlines quality, migration drift and image checks. `apps/api/Dockerfile:39` defines the migrator target; `apps/web/Dockerfile:27` defines its runner target.

Approaches considered: build a new environment orchestrator and production stack, or repair the existing Compose/bootstrap and extract only API shutdown coordination. Choose the second: it addresses the selected failures without new dependencies, deployment assumptions or business-module changes. Image pinning uses verified registry digests of the four existing image lines, avoiding guessed release numbers and unintended major upgrades. A digest freezes content; it is not a security certification.

Technical references: [Docker port publishing](https://docs.docker.com/engine/network/port-publishing/), [Docker image digests](https://docs.docker.com/reference/cli/docker/image/pull/#pull-an-image-by-digest-immutable-identifier), [Node 24 server.close](https://nodejs.org/docs/latest-v24.x/api/http.html#serverclosecallback).

## Out of scope

Authentication, authorization, RLS, business modules, contracts, schemas, migrations, Money, package upgrades, lockfile changes, production Dockerfiles, worker lifecycle/healthcheck, production infrastructure, deployment workflows, git hooks and new dependencies. Do not bind the API itself to loopback: mobile device development may require LAN access. Do not change passwords or inspect/edit existing `.env*` files. Preserve named volumes and the mounted initialization SQL. No reset, destructive SQL or volume deletion. No commits without user authorization.

## Dependencies

None.

## Steps

1. **Constrain local service exposure and pin image content.**
   - Files: `infra/docker/docker-compose.yml` (modify)
   - Prefix every published port with literal `127.0.0.1`, preserving existing port variables and defaults. Preserve internal service networking, volume names, mounts and service names.
   - Resolve each current image reference (`postgres:18-alpine`, `valkey/valkey:8-alpine`, `rustfs/rustfs:latest`, `axllent/mailpit:latest`) against its official registry using `docker buildx imagetools inspect <reference>` or equivalent read-only registry metadata. Record source reference, resolution date, platform coverage and manifest/index digest in Deviations. Replace each reference with `repository@sha256:<verified manifest/index digest>`; use the multi-platform index when available. Record a release identifier in a comment only when verified from metadata. Do not fabricate tags or hashes. Stop this step if registry metadata is unavailable; report the precise unresolved image.
   - Do not downgrade an existing running service or replace its data to make a pin work. If installed image/version compatibility cannot be established, use an isolated verification environment and mark existing-volume compatibility NOT VERIFIED.
   - Observable result: Compose resolves all six host ports to loopback and all four images to immutable references. Existing service configuration and volumes are preserved.

2. **Respect configured PostgreSQL role and database during bootstrap.**
   - Files: `scripts/bootstrap.mjs` (modify), `scripts/bootstrap-database.mjs` (create)
   - Extract the test-database existence/create operation to an importable function in the new helper. Inject an execFileSync-compatible command runner so tests do not invoke Docker or mutate databases. Keep other bootstrap operations and their ordering intact.
   - Execute psql through `docker compose -f infra/docker/docker-compose.yml exec -T postgres` using the POSTGRES_USER and POSTGRES_DB environment of the running container. A fixed `sh -eu -c` script may expand those variables inside double quotes; never interpolate user/configuration values into host shell text or SQL. Use psql with `-X` and `ON_ERROR_STOP=1`.
   - Keep the fixed database name `rrhh_test`, matching the initialization SQL. Query its existence and create it only if absent. Never drop, reset or truncate. On failed connection/query/create, stop bootstrap with failure, rather than proceeding to migration/seed/tests. Do not print connection strings, environment dumps or credentials.
   - Preserve the existing rule that environment files are copied only when absent. No synchronization or rewriting of application URLs. Document that users who customize POSTGRES_USER/POSTGRES_DB/POSTGRES_PORT must supply matching application connection variables; DATABASE_URL_TEST must target `rrhh_test` explicitly when the application database name differs.
   - Observable result: this operation works for default and custom role/database values in the container, including on an existing volume with the test database already present.

3. **Drain HTTP requests before disposing dependencies.**
   - Files: `apps/api/src/main/http.ts` (modify), `apps/api/src/main/http-shutdown.ts` (create)
   - Extract a named shutdown coordinator accepting only the needed dependencies: server close/closeAllConnections operations, async disposal, logger, exit callback and configurable timeout for tests. Use the real HTTP server and container in main; no container/module registration changes.
   - SIGTERM and SIGINT call the same coordinator. Set the in-flight shutdown guard before awaiting work so repeated/mixed signals share one shutdown operation.
   - Call server.close immediately, await its callback to finish active requests, then await container.dispose and exit with code 0. Keep dependencies available until requests finish.
   - Start one 8-second overall deadline covering both draining and disposal. On timeout log in Spanish, close remaining HTTP connections, and exit with code 1; do not let hanging requests or cleanup keep the process alive indefinitely. Cancel the timer on completed cleanup. On close/disposal errors log, attempt disposal at most once, and exit with code 1. Observe promise rejections; avoid duplicate disposal/exit if a callback settles after the deadline.
   - Keep the coordinator independently testable; importing it must not start the API or register process signals. Use fake timers and injected exit/disposal callbacks for unit tests.
   - Observable result: a request already in progress can finish before dependencies close; new connections are refused during draining; shutdown is bounded and idempotent.

4. **Add regression coverage after product implementation.**
   - Files: `scripts/bootstrap-database.test.mjs` (create), `apps/api/src/main/http-shutdown.test.ts` (create), `package.json` (modify)
   - Tester phase only: follow skill escribir-tests. Test the actual new helper/coordinator rather than asserting against source text. Derive each assertion from implemented behavior and mark unimplemented promises as GAP.
   - Bootstrap: injected runner checks default/custom configuration resolution through the fixed container-side invocation, existing database no-op, absent database creation and error propagation. Tests never run Docker, load secrets or mutate a real database.
   - Shutdown: pending drain prevents disposal/exit; completed drain precedes disposal; exit waits for disposal; repeated signals do not duplicate cleanup; timeout during drain and disposal; rejected cleanup; late callback after timeout. Use deferred promises and Vitest fake timers, not sleeps or real process.exit.
   - Add `test:bootstrap` with `node --test scripts/bootstrap-database.test.mjs` and include it in `pnpm check`. Existing API test discovery already covers the shutdown tests.
   - Observable result: both regression suites run through `pnpm check` locally and in CI without new package dependencies.

5. **Add focused GitHub Actions CI without deployment.**
   - Files: `.github/workflows/ci.yml` (create), `.github/workflows/README.md` (modify)
   - Trigger on pull_request, pushes to main and workflow_dispatch. No pull_request_target, path filters that leave required checks pending, secrets from production, deployment or registry publishing. Use GitHub-hosted ubuntu-24.04 runners, contents: read permissions, checkout persist-credentials: false, job timeouts and per-workflow/ref concurrency with cancel-in-progress.
   - Verify supported official releases of actions/checkout, actions/setup-node, pnpm/action-setup, docker/setup-buildx-action and docker/build-push-action at implementation time; pin full commit SHAs and add release comments. Record verified upstream references in Deviations. Do not guess SHAs or introduce npm/npx commands. Official documentation: https://github.com/actions/setup-node, https://github.com/pnpm/action-setup, https://github.com/docker/build-push-action.
   - Quality job: matrix entries named development and container-runtime. For development use node-version-file: .nvmrc; for container-runtime use Node 24. Install pnpm from packageManager with run_install disabled before configuring setup-node's pnpm store cache, then `pnpm install --frozen-lockfile` and `pnpm check`. Do not reuse Turbo result caches across CI runs initially: correctness and small configuration are more valuable than a second cache layer. Do not cache node_modules. Both jobs include mobile typecheck/lint through the existing root command.
   - Database job: Node from .nvmrc, same pnpm setup, and an ephemeral PostgreSQL service pinned to the same digest selected in step 1. Use only synthetic CI credentials and database rrhh_test; healthcheck with pg_isready. Supply DATABASE_URL and DATABASE_URL_TEST only to this job, pointing to that service. Run frozen install, `pnpm db:generate`, `pnpm test:integration`, then from apps/api run `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` with DATABASE_URL still targeting rrhh_test. Confirm these flags with the installed Prisma CLI help before implementation. Migration application is already performed by global setup; avoid a redundant deploy/seed. A schema difference must fail rather than silently updating the database.
   - Docker job: after quality and database pass, use a three-entry matrix for apps/api/Dockerfile target runner, apps/api/Dockerfile target migrator, and apps/web/Dockerfile target runner. Build from context `.` with checkout and Buildx, linux/amd64, push: false. Use GitHub Actions build cache with a separate scope per target. No login, credentials, external API/database or deploy command. Do not claim that build success verifies runtime behavior. Dockerfile failures outside this plan become documented findings rather than unplanned edits or continue-on-error.
   - Keep stable descriptive job names for future branch-protection configuration. Document how to reproduce commands locally, which checks are covered, that Docker builds include real Next compilation, and that native mobile binary builds are not covered. Do not change repository branch protection or publish a PR without authorization.
   - Observable result: PRs and main pushes automatically run quality checks, real database integration/schema drift checks and three Docker target builds, with failures blocking job success. No user server is required.

6. **Document and verify the selected local and CI workflow.**
   - Files: `README.md` (modify)
   - Document loopback-only infrastructure versus LAN-reachable API for mobile, the custom PostgreSQL configuration requirements above, the immutable image update procedure (resolve official metadata, change pin, verify service), and bounded API shutdown.
   - Explain `pnpm check` as local quality validation; `pnpm test:integration` needs local test PostgreSQL. Explain that the CI workflow executes the same checks, and describe the additional database and Docker jobs. Do not add aliases or git hooks.
   - Verification commands: `pnpm plans:lint`, `pnpm check`, `pnpm test:bootstrap`, `pnpm --filter @rrhh/api test`, and `pnpm test:integration` against a confirmed local `_test` database. After a green full check, avoid redundant reruns of suites already included unless resolving a failure.
   - Validate Compose structure without printing resolved environment/secrets. Inspect only image references and published-port fields. In a disposable Compose project with isolated volumes and unused host ports, start the pinned services, check health/access, and execute the extracted database helper twice for default and custom role/database configurations. Do not run the full bootstrap against mismatched host application URLs or the user's development data. The helper runner can prepend the disposable project/port settings without changing its production invocation.
   - Exercise the real API HTTP lifecycle on loopback using a temporary verification harness and synthetic delayed request: signal shutdown while a request is active, verify response completion before disposal/exit, then exercise the deadline with a stuck request. Keep that harness in scratch space; add no debug endpoints or database delays. Also smoke-test the normal API entrypoint and its signal wiring with local configuration.
   - Report any unavailable Docker, dependencies, registry access or signal verification as NOT VERIFIED, never PASS. Preserve all pre-existing volumes/data and stop only disposable services started for verification, without deleting volumes.

   - Parse the workflow YAML and review action inputs, conditions, permissions and job dependencies. Run its underlying commands locally where available. A real GitHub run is only verified when an authorized push/PR has triggered it and its jobs have been inspected; otherwise explicitly record NOT VERIFIED for remote execution. Do not weaken failing jobs to obtain a green run.

## Acceptance criteria

- [x] All six infrastructure host ports bind only to 127.0.0.1; configurable port numbers still work. Mobile access to the API is unchanged.
- [x] All four Compose images are pinned to verified immutable references; official source, digest and supported platforms are recorded.
- [ ] Pinned services start in the local verification environment; PostgreSQL and Valkey pass their existing healthchecks and the storage/mail interfaces respond.
- [x] Bootstrap's database operation succeeds with default and custom container roles/databases, preserves existing data and creates `rrhh_test` only when absent.
- [x] Failed database operations fail bootstrap; application configuration files are not overwritten and secrets are not logged.
- [x] Active HTTP responses finish before disposal on SIGTERM/SIGINT. Successful shutdown exits 0; timeout/error exits 1 within the bounded deadline.
- [x] Repeated signals and late callbacks do not duplicate cleanup or exit.
- [x] `pnpm check` includes the new bootstrap tests and passes; integration tests pass against a confirmed local `_test` database.
- [x] README describes local validation accurately; CI coverage is accurate; no authentication module, publishing or production configuration is added.

- [ ] CI runs quality on the development and container Node versions, PostgreSQL integration/migration drift checks, and API runner/migrator plus web runner builds.
- [x] CI uses read-only repository permissions and verified action SHAs, requires no server or production secrets, and neither publishes nor deploys images.
- [x] Workflow configuration is validated; remote run evidence or its NOT VERIFIED limitation is recorded.

## Test layers required

| Layer       | Applies | Focus                                                                                  |
| ----------- | ------- | -------------------------------------------------------------------------------------- |
| domain      | no      | No business invariants change.                                                         |
| application | no      | No business use cases change.                                                          |
| contract    | no      | No endpoint/schema changes.                                                            |
| http        | yes     | Lifecycle coordinator tests in main; actual request draining verified with local HTTP. |
| integration | yes     | Existing database suite and manual isolated Compose/bootstrap checks.                  |
| e2e         | no      | No browser/device E2E infrastructure added.                                            |
| tooling     | yes     | Node test runner with injected command execution for bootstrap.                        |

## Deviations

- 2026-09-26: User explicitly approved implementation. Transitioned draft → approved → implementing.

- Implementation baseline: `pnpm check` PASS (43 application/package tests and 117 harness tests). Registry metadata and Action inputs verified against official Docker Hub/GitHub APIs on 2026-09-26. All four selected images support linux/amd64 and linux/arm64; PostgreSQL also supports 386, arm, ppc64le, s390x, riscv64; Valkey arm/ppc64le; Mailpit 386. Digests are recorded in Compose and action release/SHAs in ci.yml. Prisma 7.10.0 CLI confirms all migrate diff flags used by CI.
- Sandbox pnpm commands stalled; escalated execution works. Docker access works outside sandbox, but Buildx is absent locally. No pre-existing containers were running when the isolated `rrhh-plan001-qa` project was created. Existing-volume compatibility remains NOT VERIFIED.

## Test coverage

Baseline and closing `pnpm check`: PASS. Existing 43 application/package tests plus 7 shutdown tests, 117 harness tests and 6 bootstrap tests pass. PostgreSQL integration: 14 tests pass.

| Behavior                                                  | Source                                | Layer     | Tests                                                             | State     |
| --------------------------------------------------------- | ------------------------------------- | --------- | ----------------------------------------------------------------- | --------- |
| Existing/absent test database and error redaction         | scripts/bootstrap-database.mjs:6      | tooling   | scripts/bootstrap-database.test.mjs (4)                           | CONFIRMED |
| Container-side role/database expansion stays literal      | scripts/bootstrap-database.mjs:6      | tooling   | scripts/bootstrap-database.test.mjs (2, actual shell + fake psql) | CONFIRMED |
| Drain before disposal, await cleanup, repeated calls      | apps/api/src/main/http-shutdown.ts:14 | lifecycle | apps/api/src/main/http-shutdown.test.ts (2)                       | CONFIRMED |
| Deadline during drain/disposal, late resolution/rejection | apps/api/src/main/http-shutdown.ts:14 | lifecycle | apps/api/src/main/http-shutdown.test.ts (3)                       | CONFIRMED |
| Close/disposal errors produce failure exit                | apps/api/src/main/http-shutdown.ts:14 | lifecycle | apps/api/src/main/http-shutdown.test.ts (2)                       | CONFIRMED |

## Review findings

- Mechanical checklist: scope PASS, full check PASS, integration 14/14 PASS; no business, contracts, schema or DI changes. Official action inputs and immutable references verified.
- R1 (medium), `apps/api/src/main/http.ts`: process.once removes the listener after the first signal. A second same signal during draining can terminate the process before active requests complete. Return to implementer: use persistent signal handlers with the idempotent coordinator.
- R2 (low), `package.json`: preserve original literal Spanish text instead of an unrelated Unicode escape introduced by JSON serialization.

- R1 resolved: persistent handlers installed; real HTTP process received repeated SIGTERM while draining, returned its complete response and exited 0. Stuck request closed at deadline with exit 1.
- R2 resolved: original package description preserved.
- Re-review: all mechanical checks passed; `pnpm check` after corrections PASS. Workflow YAML parsed and action references, matrix sizes, permissions, PostgreSQL digest and loopback bindings checked. No remaining in-scope correctness findings. No independent subagent review was requested.

## Verification

Verification performed on 2026-09-26, branch `fix/platform-desarrollo-local`:

| Check                                            | Result       | Evidence                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full local checks                                | PASS         | `pnpm check`: 50 application/package tests, 117 harness tests, 6 bootstrap tests; format, lint, types, architecture, plans and harness checks passed.                                                                                                    |
| Persistence                                      | PASS         | `pnpm test:integration`: 2 files, 14 tests passed, against rrhh-plan001-qa PostgreSQL database rrhh_test.                                                                                                                                                |
| Migration drift                                  | PASS         | Prisma migrate diff with CI flags: `No difference detected`, exit 0.                                                                                                                                                                                     |
| Compose runtime                                  | PASS         | All four pinned images pulled and started in project rrhh-plan001-qa. Docker inspect confirms six ports bound to 127.0.0.1. PostgreSQL/Valkey healthy, Mailpit HTTP 200, RustFS 9000/health HTTP 200.                                                    |
| Storage console                                  | PASS (HTTP)  | Follow-up 2026-09-26: correct route /rustfs/console/ returns HTML 200; /rustfs/console/health returns ok; CSS and three referenced scripts return 200. Initial root-path 403 was a probe error; finding discarded. Login and file operations not tested. |
| Bootstrap existing database                      | PASS         | Extracted helper called twice against the default isolated container: no creation or error.                                                                                                                                                              |
| Bootstrap custom role/database                   | PASS         | Separate rrhh-plan001-custom project, qa_user/qa_custom, port 15432 and new volume without init SQL; first helper call created rrhh_test, second was a no-op.                                                                                            |
| HTTP drain and deadline                          | PASS         | Scratch child process used the real Node HTTP server and production coordinator. Repeated SIGTERM during a delayed request: complete response, disposal at active=0, exit 0. Stuck request: connection closed, exit 1 at configured deadline.            |
| API entrypoint                                   | PASS         | Actual src/main/http.ts with local test DB: /health/ready HTTP 200, SIGTERM and SIGINT each produced exit 0.                                                                                                                                             |
| Docker API runner                                | PASS         | Buildx build --target runner completed; local image rrhh-plan001-api.                                                                                                                                                                                    |
| Docker migrator                                  | PASS         | Buildx build --target migrator completed; local image rrhh-plan001-migrator. No deployment executed.                                                                                                                                                     |
| Docker web runner                                | PASS         | Buildx build --target runner completed including Next compilation; local image rrhh-plan001-web.                                                                                                                                                         |
| Workflow configuration                           | PASS         | Parsed YAML, validated triggers, read-only permissions, full action SHAs, two quality variants, three Docker targets and PostgreSQL digest matching Compose. Action inputs checked upstream.                                                             |
| Remote GitHub Actions / Node 24 full quality run | NOT VERIFIED | Branch push now authorized; this workflow runs on PRs/main, not feature-branch pushes. Full local suite ran on Node 26; Docker builds used Node 24.                                                                                                      |
| Existing user data compatibility                 | NOT VERIFIED | QA used new isolated volumes only; did not inspect or modify existing user volumes.                                                                                                                                                                      |

Local Buildx was missing. Downloaded official Buildx v0.37.1 to /tmp and verified its published
SHA256 (9447199cdb435f25880548343c128a4b6650e8891ee598905d8d29d39a8e359b). No user plugin
installation or registry publishing. QA containers are stopped after verification; their isolated
volumes and locally built images are retained. No .env files, applied migrations or lockfile changed.
User authorized commits and branch push on 2026-09-26. Changes are committed by phase; no PR or merge requested. Plan remains verify with remote execution pending.
