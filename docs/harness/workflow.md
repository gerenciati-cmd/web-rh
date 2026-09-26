# Workflow — the 5-phase pipeline

The pipeline is change-type agnostic: features, fixes and refactors all flow through it (the
commit type reflects which). Small diagnosed fixes may take the fast lane. Everything else is
driven by a plan file `plans/<module>-<topic>/NNN-<slug>.md` inside an initiative (format: `conventions/plans.md`,
template: `plans/_TEMPLATE.md`). The plan's frontmatter `status:` is the single source of
truth for orchestration.

## Entry points (the pipeline is a menu, not a train)

> **A plan exists to control changes to product behavior.** Activities that don't change
> behavior — writing tests, reviewing, verifying, recon, documenting — are standalone: enter
> directly, anytime, no plan needed.

| Request                                           | Entry                                    | Plan?                                   |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------- |
| New feature / new module                          | Architect → full pipeline                | Yes                                     |
| Small **diagnosed** fix                           | Fast lane (skill `fix`)                  | No (regression test + verify mandatory) |
| Undiagnosed fix / >3 files / sensitive zone       | Architect → short plan                   | Yes                                     |
| Only write tests for existing code                | Tester (skill `escribir-tests`)          | No                                      |
| Only review a diff / branch / module              | Reviewer (subagent `reviewer`)           | No                                      |
| Only verify something works                       | Verifier (skill `verificar`)             | No                                      |
| Refactor keeping behavior                         | Architect — characterization tests first | Yes, always                             |
| Redo **changing** behavior                        | Architect — it's a feature in disguise   | Yes                                     |
| Trivial adjustment, no new behavior (copy, style) | Fast lane                                | No                                      |
| Micro-feature (tiny new behavior)                 | Architect → mini-plan                    | Yes, short                              |

Two clarifications that make "quick but ordered" possible:

1. **Order lives in the conventions, not in the plan.** Architecture rules, nothing invented,
   scope discipline and the destructive-action rules apply ALWAYS, plan or no plan. The plan
   only adds coordination across phases, sessions and models.
2. **Plans scale down.** For a micro-feature every section may be one line; non-negotiable
   are exact files, Out of scope and acceptance criteria.

## Status lifecycle

```
draft → approved → implementing → testing → review → verify → done
                        ↘ blocked     (unmet depends_on or escalated deviation)
                        ↘ superseded  (terminal: abandoned or replaced)
```

Only the user moves `draft → approved` and `verify → done`, and only the user marks a plan
`superseded` (with `superseded_by:` when a replacement exists). Agents move the rest and
update the frontmatter **in the same edit** as their last change of the phase.

Review comes **before** verify: findings go back to the implementer before spending a verify
run on code that will change anyway.

### Routing (how any session orchestrates)

When asked "continue plan NNN", "what's next?", or handed a plan without instructions: read
its `status` and apply this table. For the cross-plan overview never maintain a status doc
by hand — compute it: `pnpm plans:status`.

| `status`       | Next action                                        | Claude Code                                   | Codex profile                       |
| -------------- | -------------------------------------------------- | --------------------------------------------- | ----------------------------------- |
| `draft`        | User reviews/approves. Summarize the plan and ask. | —                                             | —                                   |
| `approved`     | Implement                                          | skill `implementar` or subagent `implementer` | per `min_implementer` (table below) |
| `implementing` | Resume (read `## Deviations` for where it stopped) | same as above                                 | same as above                       |
| `testing`      | Layered tests                                      | skill `escribir-tests` or subagent `tester`   | `tester` / `tester-high`            |
| `review`       | Checklist + bug hunt → `## Review findings`        | subagent `reviewer`                           | `reviewer` / `reviewer-medium`      |
| `verify`       | Drive the running app → `## Verification`          | skill `verificar` or subagent `verifier`      | `verifier`                          |
| `blocked`      | Report WHY to the user; do not work around it      | —                                             | —                                   |
| `done`         | Nothing. Changes = new plan or fast-lane fix.      | —                                             | —                                   |
| `superseded`   | Nothing. Follow `superseded_by`.                   | —                                             | —                                   |

### Dispatch policy

- **Attended (default — the user is at the keyboard): ASK before dispatching a subagent**,
  with the question tool, e.g. "plan 004 is in `testing`: dispatch `tester`, or run it
  inline?". Never spawn silently.
- **Unattended**: dispatch without asking only when the user explicitly handed over a batch
  ("continúa los planes sin preguntarme", a loop, an overnight queue).
- Stays in the main chat regardless of mode: bug diagnosis, anything needing conversation
  context (screenshots, pasted errors), and plan writing (the architect converses).

**Role purity applies inline too**: whoever writes tests does not fix product code (bugs come
back as documented gaps); a fix that grows past the fast-lane criteria stops and goes through
a plan, even if the change looks obvious.

## The pipeline

| #   | Phase     | Role                   | Model tier                 | Output                     | Gate to advance                                    |
| --- | --------- | ---------------------- | -------------------------- | -------------------------- | -------------------------------------------------- |
| 1   | Plan      | `roles/architect.md`   | High (main chat)           | Plan file, `status: draft` | **User approves** → `approved`                     |
| 2   | Implement | `roles/implementer.md` | Per plan `min_implementer` | Code + `## Deviations`     | `pnpm check` green → `testing`                     |
| 3   | Tests     | `roles/tester.md`      | Mid                        | Tests + `## Test coverage` | `pnpm check` green (gaps as `it.fails`) → `review` |
| 4   | Review    | `roles/reviewer.md`    | High                       | `## Review findings`       | Checklist passes, findings resolved → `verify`     |
| 5   | Verify    | `roles/verifier.md`    | Mid                        | `## Verification`          | **User accepts** → `done` (+ commit)               |

### Evidence lives in the plan, not in chat

Every phase's deliverable persists to disk; a chat report evaporates with the session (and
survives subagent relay even worse). The architect writes the plan, the implementer fills
`## Deviations`, the tester fills `## Test coverage`, the reviewer fills `## Review findings`,
the verifier fills `## Verification`. A role's return message is a summary pointing at the
section, never the only copy. `pnpm plans:lint` refuses a status whose evidence section is
still empty.

## Fast lane (small fixes without a plan file)

Allowed **only if ALL of these hold**:

- It's a bug fix or trivial adjustment with a clear reproduction (not new behavior).
- Touches ≤ 3 files, in modules the user named.
- No schema/migration change, no new or changed endpoint or contract, no auth/permission
  change, no money/payroll math, nothing that changes a legal calculation (attendance hours,
  vacation balances, settlements).

The fast lane skips the _plan_, not the discipline: conventions apply, scope stays locked to
the fix, a regression test is added at the lowest layer that would have caught the bug, and
the fix is verified in the running app before committing (`fix(scope): …`). If any criterion
fails, or in doubt → it's a plan. A fix that grows mid-flight stops and goes to the architect.

## Refactors (always a plan, never fast lane)

1. **Safety net first**: if the code lacks coverage, the plan's first steps are
   characterization tests that pass on the OLD code; they stay untouched and green throughout.
2. **Acceptance criterion = observable behavior unchanged**: same HTTP responses, same
   numbers, same suites green. If the plan can't state this, it's a feature wearing a
   refactor label — split it.

## Cross-cutting rules

### Deviation protocol (what makes cheap implementers viable)

The implementer never resolves ambiguity creatively. If the plan contradicts reality (a file,
export, column, method that doesn't exist or differs):

1. **Stop** that step.
2. Log it in `## Deviations`: what the plan said / what reality is / what was done.
3. Cosmetic (typo in a path, renamed variable) → fix forward and record. Design or scope
   impact → `status: blocked` and escalate.

### Dependencies (`depends_on`)

Code is never planned or written against code that doesn't exist yet.

- **Architect**: may only assume code verified in the repo (cited `file:line`) or from plans
  with `status: done`. Anything else goes in `depends_on`, and dependent steps are written
  against the interface the dependency promises, clearly marked.
- **Implementer**: before starting, every `depends_on` must be `done`; otherwise
  `status: blocked` and stop.

### Commits (one per phase)

Each phase closes with one atomic commit that includes the plan file with its new status and
evidence (`conventions/commits.md`): `docs(x): plan 003 de … (draft)` → `feat(x): …` →
`test(x): … (plan 003)` → `fix(x): hallazgos de la revisión (plan 003)` → `docs(x): verificación
del plan 003 (PASS)` → `docs(x): plan 003 en done`. Only the main session commits, only when the
user asked for or authorized commits, staging explicit paths. No AI attribution trailers.

### Closing an initiative

When the last plan of a series is `done`, the main session fills the README's "Delivered" section
(what shipped, where it's documented) and moves any leftover ideas to "Considered and discarded"
or to findings. Commit: `docs(<scope>): cierre de la serie <initiative>`.

### Scope lock

No role touches files outside the plan's listed files plus append-only additions to shared
hot files (`HARNESS.md`). "I fixed something nearby while I was there" is a violation, not a
favor — the nearby problem becomes a finding in `plans/hallazgos/`. `pnpm plans:scope <plan>`
makes it checkable (it always allows the plan, its initiative README and new findings).

### Choosing `min_implementer`

- `small`: only mechanical plans — a CRUD that copies the reference module step by step,
  renames, copy/style changes. Every step names exact files and exact results.
- `mid`: default for everything else.
- `high`: the exception — implementation itself demands judgment even with a good plan
  (concurrency, cross-module transactions, tricky migrations). If you reach for `high`
  because the steps are vague, the fix is a better plan, not a bigger model.
- **Always `mid`+** when the plan touches: payroll/money math, legal calculations (attendance
  hours, vacation accrual, settlements), auth/permissions/tenancy, migrations that rewrite
  data. Errors there are silent (plausible-looking numbers), not exceptions.

#### Model dispatch (cost-aware — lowest option that satisfies the tier)

| Tier    | Claude Code (`Agent` → `model`) | Codex profile (`.codex/agents/`)           |
| ------- | ------------------------------- | ------------------------------------------ |
| `small` | `haiku`                         | `implementer-small` (`gpt-5.4-mini`, low)  |
| `mid`   | `sonnet`                        | `implementer` (`gpt-5.6-terra`, medium)    |
| `high`  | `opus` (or `fable`)             | `implementer-high` (`gpt-5.6-terra`, high) |

Fixed profiles for the other phases: tester → `sonnet` / Codex `tester` (medium),
`tester-high` only when recon genuinely needs it; reviewer → `opus` / Codex `reviewer`
(`gpt-5.5`, high) or `reviewer-medium` for small diffs; verifier → `sonnet` / Codex
`verifier` (`gpt-5.6-terra`, medium). The architect runs in the main chat with a high-tier
model. Codex model names are deployment-specific and live only in
`scripts/harness/adapters.mjs`; change them there and run `pnpm harness:sync`.

The orchestrating chat may be a stronger model than the dispatched tier. That does not raise a
plan's `min_implementer`: it preserves the plan's tier and dispatches the cost-appropriate model.

## Commands reference

```bash
pnpm plans:status                 # what needs attention, computed from frontmatter
pnpm plans:lint                   # plan format + status/evidence coherence (in pnpm check)
pnpm plans:scope plans/x/001-y.md # diff vs. the plan's file list
pnpm check                        # format, types, lint, unit+http tests, arch, hooks, plans, harness
pnpm test:integration             # Prisma adapters against the test DB (needs pnpm db:up)
pnpm harness:sync                 # regenerate agent/skill adapters from the role docs
```
