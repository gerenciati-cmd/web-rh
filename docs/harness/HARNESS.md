# RRHH Harness — Vision & Map

> All non-trivial work flows through a pipeline of versioned artifacts
> (plan → implementation → tests → review → verification), executable by any AI agent or
> human. Each phase has defined inputs, outputs and exit criteria. The state lives in the
> plan file; the evidence lives in the plan file; the guardrails are enforced by tools, not
> by good intentions.

Read this first, then `workflow.md`. Architecture and code conventions (in Spanish) live in
`docs/architecture.md` and `docs/conventions.md`; this directory only governs **process**.

| Doc                       | Purpose                                                         |
| ------------------------- | --------------------------------------------------------------- |
| `workflow.md`             | Pipeline, statuses, routing, fast lane, deviations, model tiers |
| `roles/architect.md`      | Writes plans. Read-only on code.                                |
| `roles/implementer.md`    | Executes an approved plan literally.                            |
| `roles/tester.md`         | Layered tests, "nothing invented".                              |
| `roles/reviewer.md`       | Conventions checklist + bug hunt against the plan.              |
| `roles/verifier.md`       | Drives the real running app.                                    |
| `conventions/plans.md`    | Initiatives, plan semantics/format, findings, lint rules.       |
| `conventions/commits.md`  | Commit format, one commit per phase, staging, no attribution.   |
| `conventions/backend.md`  | API checklist (points to docs/architecture + recipes).          |
| `conventions/frontend.md` | Web + mobile checklist.                                         |
| `conventions/testing.md`  | Testing contract: layers, nothing invented, execution budget.   |
| `modules.json`            | Module registry (machine-readable).                             |

## Architecture of the harness: agnostic core + generated adapters

Everything that defines the process is plain markdown in this directory plus `plans/`.
Tool-specific layers are **generated** from it — never hand-edited:

```
docs/harness/roles/*.md  ──┐
scripts/harness/adapters.mjs (names, models, per-role glue)
                           ├──▶ pnpm harness:sync ──▶ .claude/agents/*.md      (Claude subagents)
                           │                        ─▶ .claude/skills/*/SKILL.md (Claude skills)
                           │                        ─▶ .codex/agents/*.toml     (Codex profiles)
                           └────────────────────────▶ .agents/skills/*/SKILL.md (Codex skills)
```

`pnpm check` runs `harness:check`, which fails if any adapter drifted from its source. To
change an adapter, edit the role doc or `scripts/harness/adapters.mjs` and run
`pnpm harness:sync`. (Hand-written recipe skills — `new-module`, `new-use-case`,
`db-change` — are not generated; they are conventions detail, not roles.)

There is no runtime orchestrator. **Orchestration is a protocol, not a process**: any
session, any tool, any model, or a human reads a plan's `status:` and the routing table in
`workflow.md` and knows what happens next. `pnpm plans:status` computes the overview.

## Mechanical enforcement (what is NOT left to good intentions)

| Guarantee                                                                        | Enforced by                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------- |
| Layer and module boundaries                                                      | `pnpm arch:check` (dependency-cruiser)       |
| Plans are well-formed, statuses coherent                                         | `pnpm plans:lint` (in `pnpm check`)          |
| Diff stays inside the plan's file list                                           | `pnpm plans:scope <plan>` (reviewer runs it) |
| Adapters match their role docs                                                   | `pnpm harness:check` (in `pnpm check`)       |
| No destructive shell/git/db/docker commands                                      | `.claude/hooks/guard-bash.mjs` (+ its tests) |
| No edits to secrets, lockfile, generated, applied migrations, generated adapters | `.claude/hooks/guard-files.mjs`              |
| Formatting                                                                       | `.claude/hooks/format-file.mjs`, lint-staged |
| Commit format, registry scopes, no AI attribution, no generic subjects           | commitlint (`commit-msg` hook)               |
| Explicit staging only (no `git add -A` / `.` / `commit -a`)                      | `.claude/hooks/guard-bash.mjs`               |

Codex does not run Claude hooks. That is why its generated profiles carry the destructive
rules as text, and why the scripts above run in `pnpm check` regardless of the tool.

## Module registry

`modules.json` is the source of truth; a plan's `module:` must be one of its names.

- **Reference**: `employees` — the canonical pattern. New modules imitate it by name
  (`apps/api/src/modules/employees/...`).
- **Active**: `organization`, `web`, `mobile`, `platform` (cross-cutting work).
- **Planned**: `identity`, `attendance`, `leave`, `payroll`, `documents` — a plan may create
  them; nothing may assume they exist until that plan is `done`.

## Shared hot files (append-only)

Edited by many plans; merge-conflict magnets. Append inside your module's entry only; never
reorder, regroup or "clean up" surrounding code. `plans:scope` allows them even if the plan
does not list them, but the reviewer still checks the change is append-only.

- `apps/api/src/container.ts` (module list + `Cradle`)
- `packages/contracts/src/index.ts` (exports + `apiRoutes`)
- `apps/api/prisma/schema.prisma` (new models/schemas; never edit other modules' models)
- `apps/api/tests/test-app.ts` (in-memory overrides)
- `docs/harness/modules.json` (a new module here also becomes a commit scope automatically)

## Security rules (all roles, no exceptions)

- Never read, copy or quote `.env*` contents (except `.env.example`) into code, plans, tests,
  commits or chat. Refer to configuration by variable name (`DATABASE_URL`).
- Never commit secrets, keys, dumps or real personal data (RUTs, salaries) — fixtures use
  synthetic data.
- Tests that touch a database use the **test database** (`DATABASE_URL_TEST`, name ends in
  `_test`); the integration harness refuses to run otherwise.

## Destructive actions (all roles, no exceptions)

**Nothing outside your plan's file list gets deleted, overwritten, reverted or "cleaned up".
Ever.** If an action is hard to reverse and the user did not name the thing explicitly,
don't do it — ask (attended) or set `status: blocked` (subagent).

These rules come from real incidents in a previous project: subagents "tidying up" deleted
untracked user files that git could not restore, reverted a user's uncommitted edit to an
unrelated file, and `git stash`-ed a worktree shared by six parallel implementers. The hooks
now block the commands; the rules below explain the intent so you do not look for a way
around them.

**Files**

- Never delete a file you did not create in this session. Untracked (`??`) does **not** mean
  disposable. `rm` of untracked files, globs, `find -delete` and `git clean` are blocked.
- Ignore untracked noise instead: `git status --short | grep -v '^??'`.
- Your temp files go to the session scratchpad (or `/tmp`), never the repo.
- Read a file before overwriting it if you did not write it.
- **Never `git stash`, `git checkout -- <file>`, `git restore <file>`** — not even on your own
  files, not even "to get a baseline". A dirty tree is someone's uncommitted work, possibly
  another agent's in the same worktree. (All blocked.)
- **Safe baseline for "was this failure pre-existing?"**, touching only files you modified:
  1. copy each of your modified files to the scratchpad;
  2. `git show HEAD:<path> > <path>` for those files only;
  3. run the relevant tests;
  4. copy your versions back and confirm with `git diff --stat` that your changes are intact.

**Database**

- Schema changes only via new Prisma migrations (`pnpm db:migrate --name …`). Never edit an
  applied migration; never `db push` or `migrate reset` (blocked).
- No `DELETE`/`UPDATE` whose `WHERE` you have not first proven with `SELECT COUNT(*)`; if the
  count disagrees with the plan, stop (`status: blocked`) — never adjust the plan to match.
- A migration that drops or rewrites data needs the user's explicit approval in the plan.
- Seeded verification data is removed afterwards — only the rows you seeded.

**Production**

- Never run migrations, seeds or any write path against a non-local environment.
