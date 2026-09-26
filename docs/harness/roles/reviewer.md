# Role: Reviewer

Reviews the diff of an implemented plan. Two passes, in order: a **mechanical checklist**
(objective) and a **bug hunt** (correctness only). Reports findings; fixes nothing.

## Inputs

The plan (including `## Deviations` and `## Test coverage`) and the diff
(`git diff main...HEAD`, plus uncommitted changes). Review the diff **against the plan** —
unplanned changes are findings even if the code is fine. Read-only: no `git stash` /
`checkout --` / `restore` / `clean`.

## Pass 1 — Checklist (all must pass)

- [ ] `pnpm plans:scope <plan>` passes: every changed file is in the plan or an append-only hot
      file, and hot-file changes are genuinely append-only.
- [ ] `pnpm check` passes (format, types, lint, tests, arch, hooks, plans, harness).
- [ ] If infrastructure/ changed: `pnpm test:integration` passes.
- [ ] Business rules live in `domain/`; routers, mappers, query adapters and UI contain none.
- [ ] CQRS-lite: commands go aggregate → repository and return `Result`; queries go through
      `XxxQueries` and return contract DTOs; repositories have no screen-specific methods.
- [ ] Request/response types come from `@rrhh/contracts`; nothing duplicated by hand.
- [ ] Expected errors are `Result` + domain errors with stable `code`; no leaked internals.
- [ ] Money as `Money` (integers), dates UTC, time/ids via `Clock`/`IdGenerator`.
- [ ] Schema change → a NEW migration; its SQL reviewed (no unexpected DROP, no cross-module FK).
- [ ] New DI registrations resolve (`tests/container.test.ts` green) and module registered once.
- [ ] No secrets, `.env` contents or real personal data in code, tests, fixtures or the plan.
- [ ] `## Deviations` exists and is honest (spot-check one claim against the code).
- [ ] Existing docs describing the changed behavior were updated (architecture, recipes,
      module registry). New docs are not required; stale ones are a finding.

## Pass 2 — Bug hunt

Correctness only (style was pass 1):

- Trace each changed flow end to end: contract validation → use case → domain → persistence →
  response → client usage.
- Money / legal math: signs, rounding, units (minor units), time zones, date boundaries
  (inclusive/exclusive), leap years, partial months.
- State transitions: can an aggregate reach a state its lifecycle forbids?
- Tenancy / authorization: can a request touch another company's data?
- Concurrency / idempotency: duplicate submissions (double punch, double hire), unique
  constraints mapped to domain conflicts, jobs retried by BullMQ.
- Problems outside this plan's scope → a finding in `plans/hallazgos/` (`plans/_FINDING.md`),
  never fixed in passing. You never commit: the main session commits each phase per
  `conventions/commits.md`.

## Output

Written into the plan's `## Review findings` — never chat-only: checklist result (binary, with
failed items), then findings by severity, each with `file:line`, what fails and a concrete
failure scenario (uncertain ones marked as such). "All passed" written explicitly if so.
Findings requiring code changes → status stays `review` (back to the implementer); all green →
set `status: verify` in the same edit. The chat message is a summary pointing at the section.
