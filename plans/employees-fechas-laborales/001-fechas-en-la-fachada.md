---
status: verify
module: employees
min_implementer: small
depends_on: []
---

# 001 — Dates in the employees facade

## Context

`EmployeeSummary`, the only view other modules get of a colaborador, has `id`, `companyId`,
`email`, `fullName`, `rfc`, `siteId` and `active`
(`apps/api/src/modules/employees/application/employees.facade.ts:7-15`), built in
`findEmployee` from the aggregate snapshot
(`apps/api/src/modules/employees/application/employees.facade.ts:39-52`). The aggregate already
holds `hireDate: Date` and `termination: EmployeeTermination | null`
(`apps/api/src/modules/employees/domain/employee.ts:44,47`). Attendance needs both dates to build
jornadas only while the colaborador is employed (README decision 1).

Approach: add two read-only fields to `EmployeeSummary`, as `YYYY-MM-DD` strings like the
directory DTO already formats them (`apps/api/tests/test-app.ts:105-107`). It is additive: the
only consumers pick fields by name (`apps/api/src/modules/identity/infrastructure/employees-employee-directory.ts:13`,
`apps/api/src/modules/attendance/infrastructure/employees-site-roster.ts:22`,
`apps/api/src/modules/attendance/infrastructure/employees-shift-employee-directory.ts:13`), and
the only test double of `findEmployee` is a `vi.fn`
(`apps/api/src/modules/attendance/infrastructure/employees-punch-owner-directory.test.ts:10`).

## Out of scope

- Any consumer change (attendance plan 002 consumes the fields).
- New facade methods, queries or endpoints.

## Dependencies

None

## Steps

1. **Expose the dates**
   - Files: `apps/api/src/modules/employees/application/employees.facade.ts` (modify), `apps/api/src/modules/employees/application/employees.facade.test.ts` (modify)
   - Do: add to `EmployeeSummary` `hireDate: string` (docblock "Fecha de contratación
     YYYY-MM-DD") and `terminationDate: string | null` ("Fecha de baja YYYY-MM-DD; null si está
     activo"). In `findEmployee`, destructure `hireDate` and `termination` from the snapshot and
     return `hireDate: hireDate.toISOString().slice(0, 10)` and
     `terminationDate: termination?.date.toISOString().slice(0, 10) ?? null`.
   - Observable result: `pnpm typecheck` and `pnpm check` pass.

## Acceptance criteria

- [ ] `EmployeesApi.findEmployee` returns `hireDate` (`YYYY-MM-DD`) for every colaborador and
      `terminationDate` = the stored termination date for a terminated one, `null` for an active one.
- [ ] `pnpm check` passes; no other module changed.

## Test layers required

| Layer       | Applies | Focus                                                                              |
| ----------- | ------- | ---------------------------------------------------------------------------------- |
| domain      | no      |                                                                                    |
| application | yes     | `employees.facade.test.ts`: both dates for an active and a terminated colaborador. |
| contract    | no      |                                                                                    |
| http        | no      | No route changes.                                                                  |
| integration | no      | No persistence change.                                                             |
| e2e         | no      | (no e2e infrastructure yet)                                                        |

## Deviations

None.

## Test coverage

| Behavior                                                         | Source (`file:line`)                            | Layer       | Test (`employees.facade.test.ts`)                                                  | State     |
| ---------------------------------------------------------------- | ----------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- | --------- |
| `hireDate` as `YYYY-MM-DD`, `terminationDate` null when active   | `employees.facade.ts:49-50`                     | application | findEmployee expone la fecha de contratación y terminationDate null para un activo | CONFIRMED |
| `terminationDate` = stored termination date for a terminated one | `employees.facade.ts:50`, `employee.ts:134-152` | application | findEmployee expone la fecha de baja de un colaborador dado de baja                | CONFIRMED |

No GAP / NOT CONFIRMED. Other layers not required by the plan.

## Review findings

Review 2026-10-14 (reviewer subagent). Diff base: `origin/main` (commits `4b8a02f`, `b8e7ee7`;
the plan-doc commits and the uncommitted change of `attendance-asistencia-diaria/002` are
another plan's and were excluded).

### Checklist — 12/13 passed

- [ ] `pnpm plans:scope <plan> --base origin/main` — **fails mechanically (exit 1)**. Flagged:
      `employees.facade.test.ts` (Low-2 below) and the two `attendance-asistencia-diaria` plan
      files (another plan's docs, not this diff). No product file outside `employees.facade.ts`.
      No hot files touched. (With the default base `main` the local `main` is stale and reports
      82 files; use `--base origin/main`.)
- [x] `pnpm check` passes (format, typecheck, lint, tests 19/19 turbo tasks, arch, plans,
      harness, quality).
- [x] Integration: N/A, no `infrastructure/` change.
- [x] No business rules outside `domain/`: the facade only formats snapshot fields.
- [x] CQRS-lite: facade read via repository is pre-existing; unchanged shape.
- [x] Contracts: N/A (internal facade type, not an HTTP DTO).
- [x] Errors: N/A.
- [x] Dates UTC: `toISOString().slice(0, 10)` over `@db.Date` columns (UTC midnight), same
      formatting as the domain (`employee.ts` `TerminationBeforeHireError`) and `test-app.ts`.
- [x] Schema: none.
- [x] DI: none.
- [x] No secrets / personal data (test RFC is synthetic, existing fixture).
- [x] Deviations "None." — spot-checked: code matches step 1 literally (`employees.facade.ts:15-18,46-57`).
- [x] Docs: no doc describes `EmployeeSummary` fields (grep `docs/`); nothing stale.

### Findings

**Medium-1 — `terminationDate` docblock misstates the contract** —
`apps/api/src/modules/employees/application/employees.facade.ts:17`. It says "null si está
activo", but it is also `null` for a `TERMINATED` colaborador whose baja predates the field
(`employee.ts:45-47`: termination is "nulo … en bajas anteriores al campo"; the mapper only builds
it with date and reason, `employee.mapper.ts:30-32`). Scenario: a legacy terminated row returns
`{ active: false, terminationDate: null }`; a consumer reading the docblock (the attendance plan
002 port drops `active`, `002-jornada-diaria-guardada.md:182-184`) treats `null` as "still
employed" and builds jornadas/faltas after the person left. Fix in scope: docblock states both
cases and that `active` disambiguates (one-line comment change; optionally a facade test for a
`TERMINATED` row with `termination: null`). The consumer-side risk is out of scope →
`plans/hallazgos/attendance-baja-sin-fecha-en-la-jornada.md`.

**Low-2 — test file not in the plan's Files list** — the plan's step 1 lists only
`employees.facade.ts`; `employees.facade.test.ts` is named in "Test layers required" and the
tests match it, so the work is planned, but `plans:scope` flags it. No code change; the main
session may add it to step 1's Files when returning the plan to implementing.

Test review: both new tests assert the acceptance criteria (`hireDate` `YYYY-MM-DD`,
`terminationDate` null for active, stored date for terminated, `active: false`). No High findings.

Status stays `review` (Medium-1 needs a code change).

**Resolution (main session, 2026-10-14):** Medium-1 → the `terminationDate` docblock in
`employees.facade.ts` now states both null cases and that `active` tells them apart (comment only,
no behaviour change, so no new testing round). The consumer side is planned in
`attendance-asistencia-diaria/002` step 4 (finding `attendance-baja-sin-fecha-en-la-jornada` →
`planned`); the dev DB has 0 terminated rows without a date. Low-2 → step 1 declares
`employees.facade.test.ts`. `pnpm check` green after the change. Plan to `verify`.

## Verification
