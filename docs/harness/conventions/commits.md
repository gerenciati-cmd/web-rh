# Commit conventions

Enforced by commitlint (`commitlint.config.mjs`, `commit-msg` hook) where marked ⚙.

## Format

```
<type>(<scope>): <subject>

<body — optional, wrapped at ~90 columns>
```

- ⚙ **type**: `feat` · `fix` · `refactor` · `perf` · `test` · `docs` · `style` · `build` · `ci`
  · `chore` · `revert`.
- ⚙ **scope**: required. A module from `docs/harness/modules.json` (`employees`, `attendance`,
  `payroll`, …) or a cross-cutting scope (`api`, `web`, `mobile`, `contracts`, `api-client`,
  `domain`, `config`, `db`, `infra`, `deps`, `docs`, `harness`, `repo`). The scope list is
  derived from the registry — a new module gets its scope automatically.
- **subject**: Spanish, lowercase start, imperative or descriptive, no trailing period, ≤ 72
  chars (⚙ 100 hard limit). Says WHAT changed in business terms:
  `feat(attendance): marcación con geocerca y hora del servidor`, not `feat(attendance): cambios`.
- ⚙ **No AI attribution**: no `Co-Authored-By:` trailers, no "Generated with …" lines. The
  author of record is the human who owns the repo.
- ⚙ Generic subjects are rejected: `cambios`, `wip`, `fix`, `update`, `arreglos`, `varios`.

## One commit per pipeline phase

Each phase closes with one atomic commit that includes the plan file (its status and evidence
section moved in the same edit). The plan number goes in the subject, so `git log` tells the story:

| Phase closes              | Commit                                                                           |
| ------------------------- | -------------------------------------------------------------------------------- |
| Plan written              | `docs(<scope>): plan 003 de <tema> (draft)`                                      |
| Plan approved by the user | (no commit needed; the status change rides with the next one)                    |
| Implementation            | `feat(<scope>): <qué se construyó>` — body: `Plan 003 a testing.`                |
| Tests                     | `test(<scope>): <qué cubren> (plan 003)` — body: counts per layer, GAPs          |
| Review findings fixed     | `fix(<scope>): hallazgos de la revisión (plan 003)` — body: findings by severity |
| Verification              | `docs(<scope>): verificación del plan 003 (PASS)` or `(FAIL)`                    |
| User accepts              | `docs(<scope>): plan 003 en done`                                                |
| Fast-lane fix             | `fix(<scope>): <síntoma corregido>` — body: root cause + regression test         |
| Series closed             | `docs(<scope>): cierre de la serie <iniciativa>` (README "Delivered")            |

A series of plans implemented together may share phase commits
(`test(conta): … (planes 002-007)`), never mix phases in one commit.

### Body

Explain the **why** and anything a reviewer can't see in the diff. For review fixes, list findings
by severity as bullets (`- Alto: …`, `- Medio: …`, `- Bajo: …`). End with the status transition
when the commit moves a plan (`Plan 003 a verify.`).

## Who commits, and how

- **Subagents never commit.** The main session commits at the end of each phase, and only if the
  user asked for commits or authorized them for this plan/batch. Never push without being asked.
- **Stage explicit paths only**: `git add <path> <path>` with the files of THIS phase. Never
  `git add -A`, `git add .` or `git commit -a` (blocked): the worktree may contain the user's or
  another agent's uncommitted work, and bundling it is a violation.
- Before committing: `git status --short` and `git diff --cached --stat` — the staged set must
  equal the phase's files. Pre-existing user changes stay unstaged, untouched.
- ⚙ Hooks run on every commit (`lint-staged` formats staged files, `commitlint` validates the
  message). Never `--no-verify` (blocked): fix what the hook reports.
- One cohesive change per commit. If you notice something unrelated, it becomes a finding
  (`plans/hallazgos/`), not an extra hunk.

## Branches

`feat/<initiative>` for a plan series (`feat/attendance-marcaciones`), `fix/<module>-<slug>` for
fast-lane fixes, `chore/<slug>` for tooling. Never commit directly to `main`; merge through a PR
using `.github/pull_request_template.md`.

Repair iterations preserve dated phase evidence; only the main session commits with existing user authorization. Repairing a plan grants no new commit/push permission.
