# Testing contract

## The golden rule: nothing invented

Every test derives from one of two sources, and only these:

1. **Real code**: contracts, aggregates, use cases, adapters, routes (cite `file:line`).
2. **Verifiable local execution**: real endpoint responses, real rows in the test DB, real
   rendered output.

What you cannot confirm by either source **does not become a test that assumes it**:

| Situation                                                     | Mark                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Confirmed from code or execution                              | normal `it(...)` — **CONFIRMED**                                                                                       |
| Can't be confirmed locally (external service, device-only UI) | `it.skip('NOT CONFIRMED: <why> …')`                                                                                    |
| Plan promises it, code doesn't do it (**GAP**)                | `it.fails('GAP: <plan ref> …')` — passes while the gap exists and turns red when someone fixes it, so it gets promoted |

Never weaken an assertion to make a test pass. A test that "passes" on invented behavior is
worse than no test: false confidence that breaks on the first refactor.

## Layers — test at the lowest layer that truly validates

| Layer       | Where                                                          | Validates                                       | Runs in                 |
| ----------- | -------------------------------------------------------------- | ----------------------------------------------- | ----------------------- |
| domain      | `apps/api/src/modules/<m>/domain/*.test.ts`, `packages/domain` | invariants, rules, events                       | `pnpm check`            |
| application | `.../application/**/*.test.ts`                                 | use cases with in-memory adapters + fakes       | `pnpm check`            |
| contract    | `packages/contracts`, `packages/api-client`                    | schemas accept/reject what the domain does      | `pnpm check`            |
| http        | `apps/api/tests/*.test.ts` (supertest, in-memory container)    | status codes, error `code`s, validation, wiring | `pnpm check`            |
| integration | `apps/api/tests/integration/<m>/*.int.test.ts`                 | Prisma adapters against the real test DB        | `pnpm test:integration` |
| e2e         | not set up yet                                                 | user flows in a browser/device                  | —                       |

A field validation is an http/contract test, not e2e. A state transition is a domain test,
not only an http test. Unique constraints and query filters/pagination are integration tests.
E2E infrastructure (Playwright for web, Maestro for mobile) must be added by a plan before any
plan may require the e2e layer.

## Tools and existing infrastructure (don't reinvent)

- Fakes: `apps/api/src/shared/testing/fakes.ts` (`FixedClock`, `SequentialIdGenerator`,
  `RecordingEventBus`). In-memory adapters: `<module>/infrastructure/in-memory/`.
- HTTP: `apps/api/tests/test-app.ts` builds the real container with in-memory persistence.
- Integration: `apps/api/tests/integration/support.ts` gives a Prisma client bound to
  `DATABASE_URL_TEST` (refuses to run unless the DB name ends in `_test`) and a per-test cleanup
  of the module's tables.
- Test names in Spanish, describing behavior. Arrange-Act-Assert, one behavior per test,
  deterministic (no real clock, network or random ids in unit tests), synthetic data only.

## Coverage matrix (the tester fills `## Test coverage` in the plan)

| Behavior (from plan / code)       | Source (`file:line`) | Layer  | Test                             | State               |
| --------------------------------- | -------------------- | ------ | -------------------------------- | ------------------- |
| Rejects hire date > 90 days ahead | `employee.ts:57`     | domain | `employee.test.ts › no permite…` | CONFIRMED           |
| …                                 |                      |        |                                  | GAP / NOT CONFIRMED |

## Forbidden antipatterns

1. Asserting on source text (reading a `.ts` file and matching strings).
2. Tests that assume endpoints, fields, columns or error codes from a plan without confirming
   them in code.
3. Weakening assertions to pass; `.skip` without a `NOT CONFIRMED:` reason.
4. Hitting the dev database, the network or the real clock from unit/application/http tests.
5. Fixture ids or data that collide across tests (use `SequentialIdGenerator` / per-test data).
