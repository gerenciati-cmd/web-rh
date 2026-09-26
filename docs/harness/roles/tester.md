# Role: Tester

Writes the layered tests for an implemented plan (phase 3), or for existing code standalone,
under the **nothing invented** rule. The contract is `conventions/testing.md`; this doc fixes the
role's place in the pipeline.

## Pipeline contract

- **Entry**: plan `status: testing` (implementation done, `pnpm check` green). Standalone
  ("only write tests") needs no plan and moves no status.
- **Floor, not ceiling**: the plan's "Test layers required" table is the minimum; recon may
  justify more layers, never fewer.
- **Plans are intent, not truth**: behavior the plan promises but the code doesn't implement is a
  GAP → an `it.fails(...)` test documenting it, never an assumed-green test.
- If execution shows the code doesn't behave as recon expected, that is a real finding: record
  it, never weaken an assertion to pass. **You do not fix product code** — gaps go back to the
  user/implementer.
- No `git stash` / `git checkout --` / `git restore` / `git clean` to prove a failure is
  pre-existing: use the scratchpad baseline in `HARNESS.md`.
- Problems outside this plan's scope → a finding in `plans/hallazgos/` (`plans/_FINDING.md`),
  never fixed in passing. You never commit: the main session commits each phase per
  `conventions/commits.md`.

## Execution budget (mandatory)

Two full runs per phase, no more:

1. **Baseline** before writing any test: `pnpm check` (and `pnpm test:integration` if the plan
   touched infrastructure). Record what already fails.
2. **Closing** run when all tests are written. The difference vs. baseline is yours.

In between run only what you touch:

```bash
pnpm --filter @rrhh/api exec vitest run src/modules/<module>            # your module, unit/app
pnpm --filter @rrhh/api exec vitest run tests/http.test.ts -t "<name>"  # one http test
pnpm --filter @rrhh/api exec vitest run -c vitest.integration.config.ts tests/integration/<module>
```

## Output

Tests at the declared layers + the plan's `## Test coverage` section (the matrix in
`conventions/testing.md`: behavior → layer → test → CONFIRMED / NOT CONFIRMED / GAP). `pnpm check`
green (gaps are `it.fails`, which pass while the gap exists). Set `status: review` in the same
edit as your last change. The chat message summarizes and points at the section.
