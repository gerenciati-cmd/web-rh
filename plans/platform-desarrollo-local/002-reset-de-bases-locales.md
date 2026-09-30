---
status: testing
module: platform
min_implementer: mid
depends_on: []
---

# 002 — `pnpm db:reset`: rebuild the local development and test databases

## Context

Recon baseline: `c8907a7`, 2026-09-29. Implements README decisions 7–10.

Motivation: the development database kept two companies with `country = 'CL'` after the supported
countries changed to MX/DO/CO. `pnpm bootstrap` then failed in `pnpm db:seed`. There is no
sanctioned way to rebuild a local database from zero. Agents are blocked from doing it by hand,
correctly.

What exists today:

- `scripts/bootstrap.mjs:50-57` ensures `rrhh_test`, then generates the client, deploys
  migrations, seeds and runs integration tests. The file header (`:4`) promises it never
  deletes data; this plan does not change that file.
- `scripts/bootstrap-database.mjs:4` builds the in-container psql invocation. It resolves
  `$POSTGRES_USER`/`$POSTGRES_DB` inside the container and uses `-X -v ON_ERROR_STOP=1`.
  `:6` takes an injectable `execFileSync`-compatible runner. `:20` pipes output. `:30-35`
  replaces subprocess errors with a fixed Spanish message so connection details never leak.
  `scripts/bootstrap-database.test.mjs:10-80` tests that function with fake runners and a fake
  `psql` binary; it never touches Docker.
- `infra/docker/docker-compose.yml:16-18` defaults role/database to `rrhh`, and `:21` binds the
  port to `127.0.0.1`. `apps/api/.env.example:9` and `:11` point `DATABASE_URL` and
  `DATABASE_URL_TEST` at `localhost` databases `rrhh` and `rrhh_test`.
- `apps/api/tests/integration/test-database-url.ts:8-22` uses `DATABASE_URL_TEST`, or appends
  `_test` to `DATABASE_URL`, and refuses any name not ending in `_test`.
  `apps/api/tests/integration/global-setup.ts:6-10` runs `prisma migrate deploy` against that URL.
  `apps/api/tests/integration/support.ts:17` already truncates test tables before each test, so
  wiping `rrhh_test` loses nothing of value.
- `apps/api/prisma/schema.prisma:19` spans schemas `organization`, `employees`, `identity`.
  `apps/api/package.json:20` (`db:deploy`) and `:22` (`db:seed`) are the existing API scripts.
  Root `package.json:30` exposes `db:seed`, and `:40` makes `test:bootstrap` run the bootstrap
  tests inside `pnpm check` (`:22`).
- Guards: `.claude/hooks/guard-bash.mjs:222-235` blocks `prisma migrate reset`/`db push` and
  destructive SQL through psql. It only sees the command line, so it will not see SQL that a
  pnpm script runs. `.claude/hooks/hooks.test.mjs:65` and `:111` hold the block and allow cases.
  `docs/harness/security.md:15` states Codex does not run these hooks. The script's own
  confirmation is therefore the real protection for the development database. The hook is a
  second layer for Claude Code.
- Policy: `docs/harness/HARNESS.md:127-134` forbids `migrate reset`, and `AGENTS.md:172` lists
  it as prohibited. Both must describe the new sanctioned path.

Approaches considered:

- (a) `prisma migrate reset` pointed at each database. It is already a banned command, it runs
  the seed implicitly, and it would need a hook exception that matches every spelling.
- (b) `TRUNCATE` all tables. This keeps schema drift from edited branches and old migrations,
  which is part of what a reset must fix. Discarded by decision 9.
- (c) Chosen: `DROP DATABASE … WITH (FORCE)` + `CREATE DATABASE` in the Compose container, then
  `prisma migrate deploy`, then the seed for development only.

(c) reuses the proven in-container psql pattern from `scripts/bootstrap-database.mjs`. Its
safety checks run before anything is dropped. The library/entrypoint split and the injected
runner imitate `bootstrap-database.mjs` / `bootstrap.mjs`. The tests imitate
`bootstrap-database.test.mjs`.

## Out of scope

- Changing `scripts/bootstrap.mjs`, `scripts/bootstrap-database.mjs` or their tests.
- Docker volumes, `db:down`, other Compose services (Valkey, RustFS, Mailpit).
- Remote or non-Compose databases. The command refuses them; it does not support them.
- Prisma schema, migrations, the seed contents, API code.
- Codex sandbox/permission configuration (`.codex/`).
- Loosening any existing hook rule. `prisma migrate reset`, `db push` and destructive psql stay
  blocked exactly as today.
- No commits without user authorization.

## Dependencies

None. Plan 001 of this series is in `verify`. This plan relies only on code present at the
baseline (`scripts/bootstrap-database.mjs`, `infra/docker/docker-compose.yml:21`), cited above,
and does not modify anything plan 001 touches.

## Steps

1. **Reset library with injected side effects.**
   - Files: `scripts/database-reset.mjs` (create)
   - Export `resetDatabase({ target, seed }, deps)`. `target` is `'dev' | 'test'`. `deps` holds
     `run` (execFileSync-compatible), `confirm` (async `(expectedName) => boolean`), `env`
     (object with the API environment variables) and `log`. No module-level side effects.
   - Order, each step aborting the whole operation on failure:
     1. **Resolve the database name** from the container, never from the host. For `dev`, run
        `SELECT current_database()` through the same `docker compose -f
infra/docker/docker-compose.yml exec -T postgres sh -eu -c <psql>` shape as
        `bootstrap-database.mjs:4-19` (connects to `$POSTGRES_DB`). For `test`, the name is the
        literal `rrhh_test`.
     2. **Validate the application URL** that migrate/seed will use. For `dev`, that is
        `env.DATABASE_URL`. For `test`, it is `env.DATABASE_URL_TEST`, or `DATABASE_URL` with
        `_test` appended to the path (the same rule as `test-database-url.ts:11-16`). Parse with
        `new URL`. Refuse unless the hostname is `localhost`, `127.0.0.1` or `::1`/`[::1]`, and
        the path's database name equals the resolved name from 1. For `test`, it must also end
        in `_test`. Error messages name the variable (`DATABASE_URL`), never its value.
     3. **Confirm** (`dev` only): `await deps.confirm(name)`. Abort with `Reset cancelado` if it
        returns false. `test` never asks (decision 7).
     4. **Drop and recreate** by connecting to the maintenance database `postgres` (not the
        target). Send the SQL through **stdin** (`execFileSync` `input` option) with the name
        as a psql variable (`-v db=<name>`), so it is never spliced into SQL or shell text:
        `DROP DATABASE IF EXISTS :"db" WITH (FORCE);` then `CREATE DATABASE :"db";`. For `dev`,
        the psql script passes `-v db="$POSTGRES_DB"` inside the container. For `test`, the
        literal `rrhh_test` goes as an argv element. Reuse `-X -v ON_ERROR_STOP=1 -U
"$POSTGRES_USER"`.
     5. **Migrate**: `run('pnpm', ['--filter', '@rrhh/api', 'db:deploy'], { stdio: 'inherit',
env: { ...process.env, DATABASE_URL: <validated URL> } })`.
     6. **Seed** only when `target === 'dev' && seed`: `run('pnpm', ['--filter', '@rrhh/api',
'db:seed'], { stdio: 'inherit' })`. The seed reads the same `DATABASE_URL` validated in 2.
   - Wrap steps 1 and 4 like `bootstrap-database.mjs:30-35`. A fixed Spanish message per
     operation (`No se pudo resolver la base…`, `No se pudo recrear <name>…`), without
     propagating subprocess error text or `cause`.
   - Log progress lines in Spanish, matching the `▸`/`  +` style of `scripts/bootstrap.mjs:11,51`.
   - Observable result: importing the module does nothing. With fake deps, the sequence of
     `run` calls for `dev`/`test` is exactly resolve → (confirm) → drop/create → deploy →
     (seed), and every refusal happens before any drop call.

2. **CLI entrypoint.**
   - Files: `scripts/db-reset.mjs` (create)
   - Parse `process.argv.slice(2)`. Accept only `--test` and `--no-seed`. Unknown flags, or
     `--no-seed` together with `--test` (the test database is never seeded), print a Spanish
     usage line and exit 1 before calling anything.
   - Load `apps/api/.env` with `process.loadEnvFile` when it exists (same approach as
     `test-database-url.ts:9`) into a copy passed as `env`. Never print it.
   - `confirm`: if `process.stdin.isTTY` is falsy, return false and log `El reset de la base de
desarrollo requiere una terminal interactiva`. Otherwise prompt with `node:readline/promises`
     `Escribe el nombre de la base (<name>) para borrarla:` and return true only on an exact
     match.
   - `run` = `execFileSync`. On error, print `error.message` and set `process.exitCode = 1`.
   - Observable result: `pnpm db:reset --test` runs unattended. `pnpm db:reset` without a TTY
     (e.g. `pnpm db:reset < /dev/null`) refuses without dropping anything.

3. **Root script and test wiring.**
   - Files: `package.json` (modify)
   - Add `"db:reset": "node scripts/db-reset.mjs"` next to `db:seed` (`:30`). Extend
     `test:bootstrap` (`:40`) to `node --test scripts/bootstrap-database.test.mjs
scripts/database-reset.test.mjs`. The tester creates that test file. Until it exists, the
     implementer creates an empty placeholder with a single `test.todo`, so `pnpm check` stays
     green.
   - Files: `scripts/database-reset.test.mjs` (create)
   - Observable result: `pnpm run` lists `db:reset`, and `pnpm test:bootstrap` runs both files.

4. **Hook: agents may reset only the test database.**
   - Files: `.claude/hooks/guard-bash.mjs` (modify), `.claude/hooks/hooks.test.mjs` (modify)
   - Next to the `prisma migrate reset` rule (`guard-bash.mjs:222-226`), deny when the program is
     `pnpm` and the words contain `db:reset`, or the program is `node` and an argument ends with
     `scripts/db-reset.mjs`, **unless** the argument list contains `--test`. Denial message:
     `Solo el usuario resetea la base de desarrollo; los agentes pueden usar pnpm db:reset
--test`.
   - Add to the block list (`hooks.test.mjs`, near `:65`): `pnpm db:reset`,
     `pnpm run db:reset`, `pnpm db:reset --no-seed`, `node scripts/db-reset.mjs`. Add to the
     allow list (near `:111`): `pnpm db:reset --test`.
   - Observable result: `pnpm test:harness` passes with the new cases.

5. **Documentation of the sanctioned path.**
   - Files: `AGENTS.md` (modify), `docs/harness/HARNESS.md` (modify), `README.md` (modify)
   - `AGENTS.md`: add a commands-table row after `:84`,
     `Reiniciar BD local (dev / test) | pnpm db:reset / pnpm db:reset --test`. In the prohibited
     list (`:172`), add `pnpm db:reset` without `--test`.
   - `HARNESS.md` Database section (`:127-134`): one bullet. `pnpm db:reset` is the only
     sanctioned rebuild. Development requires the user in an interactive terminal (Codex has
     no hooks, so the typed confirmation is the guard). Agents may run `pnpm db:reset --test`.
   - `README.md` "Comandos habituales" block (`:32-38`): add `pnpm db:reset` and
     `pnpm db:reset --test` with a short comment each.
   - Observable result: `pnpm format:check` passes, and the three documents agree.

## Acceptance criteria

- [ ] `pnpm db:reset --test` with infra up: `rrhh_test` is dropped and recreated, migrations are
      deployed, and there is no prompt. `pnpm test:integration` passes right after.
- [ ] `pnpm db:reset` in an interactive terminal: typing a wrong name aborts with
      `Reset cancelado` and `rrhh` rows are unchanged. Typing `rrhh` drops and recreates it,
      deploys migrations and seeds. `organization.companies` then holds exactly the seed's
      three companies (MX, DO, CO).
- [ ] `pnpm db:reset --no-seed` leaves the migrated schemas with zero rows in
      `organization.companies`.
- [ ] `pnpm db:reset < /dev/null` (no TTY) exits 1 without dropping anything.
- [ ] With `DATABASE_URL` pointing at a non-local host, or at a database name different from
      the container's, the command exits 1 before any drop, and the message does not contain
      the URL.
- [ ] `pnpm db:reset --test --no-seed` and `pnpm db:reset --foo` exit 1 with the usage line.
- [ ] Claude Code hook: `pnpm db:reset` is blocked for agents, and `pnpm db:reset --test` is
      allowed.
- [ ] `pnpm check` passes.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                       |
| ----------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | no      |                                                                                                                                                                             |
| application | no      |                                                                                                                                                                             |
| contract    | no      |                                                                                                                                                                             |
| http        | no      |                                                                                                                                                                             |
| integration | no      | Real drop/create is exercised by the verifier, not by an automated suite (it would destroy the database the integration suite uses).                                        |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                                 |
| script      | yes     | `scripts/database-reset.test.mjs` (node:test, fake deps): call order, refusals before drop, no-leak errors, no confirm for test, seed flag; hook cases in `hooks.test.mjs`. |

## Deviations

Implemented 2026-09-29, inline in the main session. All deviations are cosmetic (fixed forward):

1. **Step 1.4, dev database name as a psql variable.** The plan passed `-v db="$POSTGRES_DB"`
   inside the container. The implementation passes the name already resolved in step 1.1
   (`SELECT current_database()`) as a literal argv element (`-v`, `db=<name>`). Same value, same
   safety (argv, never shell text or SQL). Both targets share one code path.
2. **Step 1.6, seed environment.** The plan ran the seed without an explicit env. The
   implementation passes the same `{ ...process.env, ...env, DATABASE_URL: <validated URL> }` as
   migrate. `loadEnv` (`apps/api/src/config/env.ts:56`) and `prisma.config.ts:5` do not
   override existing variables, so this guarantees the seed writes to the validated database
   and not to a `DATABASE_URL` coming from the shell.
3. **Step 2, env loading.** The plan said `process.loadEnvFile`. The implementation uses
   `util.parseEnv` on `apps/api/.env`, merged as `{ ...file, ...process.env }` (same precedence
   as `loadEnvFile`). This builds the `env` copy the step asks for without mutating
   `process.env`.
4. **Step 4, hook match.** `pnpm` is matched by an exact `db:reset` argument (covers
   `pnpm db:reset` and `pnpm run db:reset`); `node` by an argument ending in
   `scripts/db-reset.mjs`. Both are denied unless `--test` is present, as specified.

Observable results checked during implementation:

- `pnpm db:reset --test` against the running infra: `rrhh_test recreada`, both migrations
  applied (`20260926030736_init`, `20260929171530_create_identity`), `✔ Listo.` Then
  `pnpm test:integration`: 6 files, 39 tests passed.
- `pnpm test:harness`: 161 pass, including the 4 new block and 1 new allow cases.
- `pnpm check`: green. `scripts/database-reset.test.mjs` holds one `test.todo` placeholder for
  the tester.
- `pnpm plans:scope … --base main`: only out-of-scope entries are the untracked, unrelated
  `plans/platform-openapi/*` drafts, which are not part of this diff and will be committed on
  their own branch.
- Not exercised by the implementer: the development reset (`pnpm db:reset`). The hook blocks
  it for agents by design, so it is left to the verifier with the user.

## Test coverage

## Review findings

## Verification
