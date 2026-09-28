# platform-calidad-integral — Architecture, conventions and AI harness hardening

## Goal

Address the confirmed architecture audit findings in one plan: reliable AI workflow and guardrails,
domain invariants, consistent expected errors, frontend quality gates and contribution conventions.
Preserve the modular monolith and valid HTTP behavior. This is maintenance, not new RRHH modules.

## Plans

| Plan                                         | Title                               | Depends on | Purpose                                                                                  |
| -------------------------------------------- | ----------------------------------- | ---------- | ---------------------------------------------------------------------------------------- |
| [001](001-calidad-convenciones-y-harness.md) | Quality, conventions and AI harness | —          | Resolve the audited defects and establish the agreed contribution rules in one delivery. |

## Dependency notes

One plan with ordered internal blocks. Harness recovery and scope validation precede product
changes; test infrastructure precedes frontend tests. Final verification covers the entire plan.
No implementation may assume the completion of another unfinished plan.

## Decisions with the user

1. (2026-09-27) Use **one plan for the whole audit**: AI, domain, frontend and conventions.
   All AI improvements stay together; do not create separate plans per finding.
2. (2026-09-27) Constants and closed sets stay in their consuming file when private. Shared
   definitions belong in a specific file of their owning module, not a global constants drawer.
3. (2026-09-27) Use literal unions when only a type is needed; lists/objects with `as const`
   when runtime values are needed, deriving types from them. TypeScript enums are not the default.
4. (2026-09-27) Use kebab-case files/directories, SCREAMING_SNAKE_CASE fixed constants,
   camelCase variables/functions, PascalCase types/classes, PascalCase + Schema for Zod schemas,
   and snake_case DB tables/columns. Document framework exceptions. Not every const is uppercase.
5. (2026-09-27) Selective docblocks document public interfaces and non-obvious invariants, units,
   errors, side effects and limits. Tags/examples must add information. CONTRIBUTING.md links
   canonical conventions rather than duplicating them.

These decisions approve the planning direction, **not implementation or commits**. Technical
choices in the plan are architect proposals pending approval of that plan.

## Delivered

<!-- Fill after verification and user acceptance. -->

## Considered and discarded

- Separate plans per finding: rejected by decision 1.
- Global constants/enums directory or a file for every private constant: rejected by decision 2.
- Mandatory TypeScript enums/docblocks on every export: rejected by decisions 3 and 5.
- Generic CRUD/base repositories: no demonstrated duplicated business knowledge justifies them.
- Immediate identity/RBAC/RLS/outbox implementation: future product work, not defects in the
  development scaffold. Keep the restriction against real sensitive data explicit.
