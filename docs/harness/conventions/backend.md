# Backend conventions (apps/api, packages/*)

This is the checklist version. The **why** and full detail live in Spanish in
`docs/architecture.md` and `docs/conventions.md`; the ADRs in `docs/adr/`. Recipes (skills,
usable by any agent as plain markdown):

| Task                      | Recipe                                 |
| ------------------------- | -------------------------------------- |
| New business module       | `.claude/skills/new-module/SKILL.md`   |
| New command or query      | `.claude/skills/new-use-case/SKILL.md` |
| Schema change / migration | `.claude/skills/db-change/SKILL.md`    |

Reference implementation: `apps/api/src/modules/employees/`. Imitate it by name.

## Non-negotiables (enforced by `pnpm arch:check` where marked ⚙)

- ⚙ Layers: `domain/` (pure) ← `application/` (use cases + ports) ← `infrastructure/` (adapters)
  · `http/`. The domain imports nothing outside itself and `@rrhh/domain`.
- ⚙ Another module is used only through its `index.ts`, and only from `infrastructure/`
  (an adapter implementing a port the consumer owns).
- ⚙ Prisma and the generated client only in `infrastructure/` (and `container.ts`).
- ⚙ No test doubles (`in-memory/`, `testing/`) imported by production code. No cycles.
- CQRS-lite: commands → aggregate + `XxxRepository` → `Result`; queries → `XxxQueries` → DTO.
- Contracts first: every endpoint in `packages/contracts` via `defineRoute`, bound with
  `bindRoute`; clients derive from it. No hand-written request/response types. Only exception:
  physical devices with their own protocol (ZKTeco ADMS `/iclock/*`) use `AppModule.deviceRouter`,
  outside `/api/v1` and the contracts (ADR 0008) — not a violation.
- Expected errors: `Result` + domain error subclass (`NotFoundError`, `ConflictError`,
  `InvalidValueError`, `BusinessRuleViolationError`) with a stable SCREAMING_SNAKE `code`.
- DI: each class declares `deps` with only what it uses; registered in its `*.module.ts`.
- Money: `Money` (integer minor units). Dates: UTC in DB; validity periods with `DateRange`.
  Time and ids only via `Clock` / `IdGenerator`.
- Schema: one Postgres schema per module, snake_case via `@map`, no cross-module relations, new
  migrations only.
- Naming: files `kebab-case.<role>.ts`; code identifiers in English; comments, error messages,
  UI text and commits in Spanish.
- No `any`, no non-null `!` in production code, `import type` for types, no default exports
  (except framework-required files).

## Canonical contribution policy

Constants, closed sets, naming and selective docblocks follow [docs/conventions.md](../../conventions.md). Do not duplicate those rules here.
