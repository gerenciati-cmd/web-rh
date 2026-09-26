---
status: draft
module: <name from docs/harness/modules.json>
min_implementer: mid
depends_on: []
---

# NNN — <Title>

<!-- Written by the Architect role (docs/harness/roles/architect.md).
     Format rules: docs/harness/conventions/plans.md. Validate with `pnpm plans:lint`.
     Every claim about existing code MUST carry a file:line citation read this session. -->

## Context

<!-- What exists today (with citations), what we need, chosen approach and why (one short
     paragraph), and which files are imitated, e.g. "command shape follows
     apps/api/src/modules/employees/application/commands/register-employee.command.ts:40-80". -->

## Out of scope

<!-- Explicit fence: refactors, adjacent bugs, UI polish not requested, other modules… -->

## Dependencies

<!-- For each depends_on: plan ref and the interface it promises. "None" if empty. -->

None

## Steps

<!-- Numbered. Each step: a `Files:` line with backticked paths + (create)/(modify), what to do,
     and the observable result. `pnpm plans:scope` reads the Files: lines. -->

1. **<Step title>**
   - Files: `packages/contracts/src/<module>/<x>.contract.ts` (create)
   - Do: …
   - Observable result: …

## Acceptance criteria

<!-- Verifiable in the RUNNING app: endpoints, status codes, JSON shapes, error codes, rows. -->

- [ ] …

## Test layers required

| Layer       | Applies | Focus                       |
| ----------- | ------- | --------------------------- |
| domain      | yes/no  |                             |
| application | yes/no  |                             |
| contract    | yes/no  |                             |
| http        | yes/no  |                             |
| integration | yes/no  |                             |
| e2e         | no      | (no e2e infrastructure yet) |

## Deviations

<!-- LEFT EMPTY by the architect. Implementer: what the plan said / what reality is / what was
     done. Write "None" explicitly if none. -->

## Test coverage

<!-- LEFT EMPTY by the architect. Tester: coverage matrix from docs/harness/conventions/testing.md
     (behavior → source → layer → test → CONFIRMED / NOT CONFIRMED / GAP). -->

## Review findings

<!-- LEFT EMPTY by the architect. Reviewer: checklist result + findings by severity with
     file:line and failure scenario. "All passed" explicitly if so. -->

## Verification

<!-- LEFT EMPTY by the architect. Verifier: suites run (decisive lines), flows driven vs.
     acceptance criteria, unhappy path, anything NOT VERIFIED flagged. -->
