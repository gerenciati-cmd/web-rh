---
status: review
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
   - Files: `apps/api/src/modules/employees/application/employees.facade.ts` (modify)
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

## Verification
