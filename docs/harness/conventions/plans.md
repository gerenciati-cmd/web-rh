# Plan conventions

Plans are the orchestration backbone: state lives in their frontmatter, phases hand off through
them, and the evidence of every phase accumulates in them. One canonical location: **`plans/`**.

## Structure: initiatives grouped by module

```
plans/
├── _TEMPLATE.md                      plan template
├── _INITIATIVE.md                    initiative README template
├── _FINDING.md                       finding template
├── employees-desvinculacion/         ← initiative = <module>-<topic>
│   ├── README.md                     ← index: goal, order, decisions, delivered, discarded
│   ├── 001-agregado-y-reglas.md
│   ├── 002-endpoint-y-contrato.md
│   └── 003-fix-hallazgos-revision.md
├── attendance-marcaciones/
│   └── …
└── hallazgos/                        ← findings: discovered, not (yet) planned
    └── payroll-redondeo-uf.md
```

- **Initiative** = a coherent series of plans toward one goal. Directory name
  `<module>-<topic>` (or exactly `<module>` for a foundational series): `<module>` is a name from
  `docs/harness/modules.json`, `<topic>` a Spanish kebab-case slug without accents
  (`attendance-marcaciones`, `payroll-liquidacion-mensual`, `platform-e2e`). An initiative belongs
  to ONE module; cross-module work is its own initiative under the module that owns the change.
- **Numbering** `NNN` is zero-padded and sequential **within its initiative**; every initiative
  starts at 001, so parallel branches never collide. Never renumber a plan once it exists.
- **Plan file names**: `NNN-<slug>.md`, slug in Spanish kebab-case without accents, describing the
  deliverable (`002-colapso-zonas-y-resolucion-de-tarifa.md`), not the phase.
- **Fix-up plans** for review/verification findings too big for the plan itself are new plans in
  the same initiative: `NNN-fix-hallazgos-<tema>.md`, with `depends_on` on the plan they fix.
- No loose plans in `plans/` root. `_`-prefixed files are templates, ignored by the tooling.

## The initiative README (`README.md`, from `_INITIATIVE.md`)

The initiative's index and memory; any session reads it before touching the series.

1. **Goal** — the business outcome, in one paragraph.
2. **Plans** — table in execution order: plan, title, depends on, one-line purpose. **No status
   column**: status lives only in each plan's frontmatter; `pnpm plans:status <initiative>`
   computes the view (a hand-kept status column always drifts).
3. **Dependency notes** — why an order exists when it isn't obvious.
4. **Decisions with the user** — dated, numbered. Business rules, scope calls, "not in this
   delivery". The architect records every decision the user made while brainstorming here; later
   plans cite them ("per decision 3 of the README").
5. **Delivered** — filled when the series closes: what shipped, where it's documented.
6. **Considered and discarded** — ideas evaluated and rejected, with the reason, so nobody
   re-proposes them blind.

## Frontmatter (required on every plan)

```yaml
---
status: draft # draft | approved | implementing | testing | review | verify | blocked | done | superseded
module: attendance # must match the initiative's <module> prefix
min_implementer: mid # small | mid | high  (rules in workflow.md)
depends_on: [] # "002" (same initiative) or "employees-desvinculacion/002" (another one)
# superseded_by: attendance-marcaciones/004   # only with status: superseded
---
```

Semantics of each status:

| Status         | Meaning                                                       | Who moves it here |
| -------------- | ------------------------------------------------------------- | ----------------- |
| `draft`        | Written, not yet approved. Nobody implements a draft.         | Architect         |
| `approved`     | User accepted the plan as the spec.                           | **User only**     |
| `implementing` | Implementer started (resume point: `## Deviations`).          | Implementer       |
| `testing`      | Code done, `pnpm check` green, Deviations filled.             | Implementer       |
| `review`       | Tests written, Test coverage filled.                          | Tester            |
| `verify`       | Review passed, findings resolved.                             | Reviewer          |
| `done`         | Verified in the running app and accepted.                     | **User only**     |
| `blocked`      | Unmet `depends_on` or an escalated deviation; reason in plan. | Any role          |
| `superseded`   | Abandoned or replaced (`superseded_by`). Terminal.            | **User only**     |

- `depends_on` is the anti-invention contract: steps may not assume code from a non-`done` plan
  unless it is listed here; the implementer refuses to start while any dependency isn't `done`.
- Whoever finishes a phase updates `status` in the same edit as their last change.

## Required sections (in this order)

Plans scale down (a 15-line mini-plan is valid). Non-negotiable even then: exact files,
Out of scope, acceptance criteria.

1. **Context** — what exists today with `file:line` citations; chosen approach and why; which
   files are being imitated; which README decisions apply.
2. **Out of scope** — explicit fence for the implementer.
3. **Dependencies** — for each `depends_on`, the interface it promises (or "None").
4. **Steps** — numbered; each with a `Files:` line listing backticked paths and
   `(create)`/`(modify)`, what to do, and the observable result. `pnpm plans:scope` reads the
   `Files:` lines — a path missing there is out of scope.
5. **Acceptance criteria** — checkbox statements the verifier checks in the running app.
6. **Test layers required** — the table from the template.
7. **Deviations** — empty until the implementer fills it ("None" if none).
8. **Test coverage** — empty until the tester fills it (matrix from `testing.md`).
9. **Review findings** — empty until the reviewer fills it.
10. **Verification** — empty until the verifier fills it.

## Findings (`plans/hallazgos/<module>-<slug>.md`, from `_FINDING.md`)

Something discovered while working that is **out of the current plan's scope**: a bug in another
module, a data inconsistency, a risky assumption. Never fixed "while passing by" — documented
here with evidence (`file:line`, queries, numbers), then triaged by the user.

```yaml
---
status: open # open | deferred | planned | resolved | discarded
module: payroll
found: 2026-09-26 # date discovered
plan: payroll-liquidacion-mensual/004 # when planned/resolved: the plan that handles it
---
```

`pnpm plans:status` lists open findings so they don't get lost.

## What `pnpm plans:lint` enforces

- Plans live in an initiative directory whose `<module>` prefix is in the registry; the plan's
  `module` matches that prefix; every initiative has a `README.md`.
- Slugs are lowercase ASCII kebab-case; numbers unique within the initiative.
- Valid frontmatter values; `depends_on` targets exist; `done` implies its dependencies are done.
- All required sections present, in order.
- Evidence matches status: from `testing` on, `## Deviations` is filled; from `review` on,
  `## Test coverage`; from `verify` on, `## Review findings`; at `done`, `## Verification`.
- Findings have valid frontmatter; `planned`/`resolved` findings point to an existing plan.

## Language

Plan and README bodies are written in English (agent-read, token economy). File/directory slugs
and Spanish domain terms (colaborador, liquidación, finiquito, marcación, feriado, AFP, Isapre)
stay in Spanish — translating them breaks traceability with code, contracts and UI. Findings may
be written in Spanish (they are often read by the business).
