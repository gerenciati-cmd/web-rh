---
status: testing
module: employees
min_implementer: mid
depends_on: ['001']
---

# 002 — Targeted writes of the colaborador

## Context

**What exists today.**

- `PrismaEmployeeRepository.save` upserts the **whole row** with no condition
  (`apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:38-69`, write at
  `:43-47`), using `EmployeeMapper.toPersistence` (`employee.mapper.ts:37`). The port has only
  `findById`, `existsInCompany`, `existsByRfc` and `save`
  (`apps/api/src/modules/employees/domain/employee.repository.ts`).
- Every command loads the row, mutates the aggregate and saves it whole:
  `RegisterEmployee` (`register-employee.command.ts:91`), `AssignEmployeeRfc`
  (`assign-employee-rfc.command.ts:42-45`), `AssignEmployeeSite`
  (`assign-employee-site.command.ts:51-53`) and `TerminateEmployee`
  (`terminate-employee.command.ts:40-46`).
- Finding `plans/hallazgos/employees-guardado-completo-pisa-la-baja.md` (review Medium-1 of plan
  001): (A) a sede/RFC change loaded before a termination and saved after it writes back
  `status: ACTIVE` and null termination; attendance then re-adds the colaborador to the
  checadores. (B) two concurrent terminations both answer 204 and publish two
  `EMPLOYEE_TERMINATED`.
- Domain: `assignRfc` (`employee.ts:156-162`) checks only the country; `assignSite`
  (`employee.ts:165-172`) returns `void` and has no rule. Neither looks at `status`.
- Attendance reconciles from the **current** state: `SyncEmployee.findTarget` returns no target
  for an inactive colaborador
  (`apps/api/src/modules/attendance/application/commands/sync-employee.command.ts:57-63`), so once
  the termination can no longer be overwritten, no attendance change is needed.
- `EMPLOYEE_INACTIVE` exists in the catalog (`packages/contracts/src/errors.ts:426-435`), thrown
  by identity (`apps/api/src/modules/identity/domain/errors.ts:144`). A code shared by two
  modules uses a catalog **variant** and a `VARIANT_BY_CLASS` entry in
  `apps/api/tests/error-catalog.test.ts:34-37` (precedent: `EMPLOYEE_NOT_FOUND` with variant
  `identity`, `packages/contracts/src/identity/invitation.contract.ts:61`).

**Approach** (README decisions 7 and 8). Replace `save` with one write per use case, as
attendance did for devices (`apps/api/src/modules/attendance/domain/device.repository.ts:6-25`,
`apps/api/src/modules/attendance/infrastructure/prisma-device.repository.ts:35-69`):
`add` (insert), `saveRfc`, `saveSite`, `saveTermination`. The three updates are
`updateMany({ where: { id, status: 'ACTIVE' } })` and treat "0 rows" as the colaborador having
been terminated meanwhile: `saveTermination` → `EmployeeAlreadyTerminatedError`, `saveRfc` and
`saveSite` → the new `EmployeeInactiveError`. The domain rejects sede/RFC changes on a TERMINATED
aggregate with the same error, so the DB condition is only the race guard. Alternative
(optimistic version column) discarded in the README (decision 7).

**In-memory adapter.** `InMemoryEmployeeRepository` hands out the **stored instance**
(`in-memory-employee.repository.ts:10-12`) and several HTTP tests mutate it without saving, so
it keeps doing that; to emulate the `WHERE status = 'ACTIVE'` guard it keeps a separate map of
the **persisted** status, updated only by its writes.

## Out of scope

- Any change to attendance or identity (their consumers already read current state).
- An optimistic version column, retries, or locking.
- Rehiring or undoing a termination; changing `positionTitle`, name or email (no endpoints).
- Rejecting other operations on terminated colaboradores beyond sede and RFC.
- New tests beyond the mechanical adaptation of existing ones (step 9) — tests are the tester's
  phase.

## Dependencies

- `employees-desvinculacion/001` (`done`): `TerminateEmployee`, `EmployeeAlreadyTerminatedError`,
  `EmployeeTermination` and the `termination_date` / `termination_reason` columns.

## Steps

1. **Contract: `EMPLOYEE_INACTIVE` for employees routes**
   - Files: `packages/contracts/src/errors.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do: in `EMPLOYEE_INACTIVE` (`errors.ts:426-435`) change `description` to "El colaborador
     está desvinculado: no se le puede invitar ni cambiar su sede o RFC." and add a variant
     `employees: { code: 'EMPLOYEE_INACTIVE', message: 'El colaborador está desvinculado', details: { employeeId: EMPLOYEE_ID } }`
     (keep `default` as is). In `employee.contract.ts` add
     `{ code: 'EMPLOYEE_INACTIVE', variant: 'employees' }` to the `errors` of
     `assignEmployeeRfc` (line 191) and `assignEmployeeSite` (line 209), and add one sentence to
     each description's "Necesita" paragraph: "El colaborador debe estar activo." Regenerate
     `openapi.json` with `pnpm --filter @rrhh/contracts openapi` (never by hand).
   - Observable result: contracts typecheck; the OpenAPI snapshot shows 422 `EMPLOYEE_INACTIVE` on
     both PUT routes.

2. **Domain: `EmployeeInactiveError` and the rule on sede/RFC**
   - Files: `apps/api/src/modules/employees/domain/errors.ts` (modify), `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/tests/error-catalog.test.ts` (modify)
   - Do: add `EmployeeInactiveError extends BusinessRuleViolationError`,
     `override readonly code = 'EMPLOYEE_INACTIVE'`, constructor `(employeeId: string)`, message
     `'El colaborador está desvinculado'`, details `{ employeeId }` (shape of
     `EmployeeAlreadyTerminatedError` in the same file). In `employee.ts`: `assignRfc` checks
     `status === 'TERMINATED'` → `err(new EmployeeInactiveError(this.id))` **first**, before the
     country check. `assignSite` becomes `assignSite(siteId, now): Result<void, EmployeeInactiveError>`:
     TERMINATED → that error first; otherwise today's behaviour, returning `ok(undefined)` (same
     site → no change, no event). Update both docblocks (README decision 8). In
     `error-catalog.test.ts:34-37` add `'employees/EmployeeInactiveError': 'employees'`.
   - Observable result: `error-catalog.test.ts` passes with the new class.

3. **Repository port: targeted writes**
   - Files: `apps/api/src/modules/employees/domain/employee.repository.ts` (modify)
   - Do: remove `save`. Add, with Spanish docblocks and an interface docblock explaining why
     (like `device.repository.ts:6-11`, citing the finding):
     - `add(employee): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>>` — insert a new colaborador.
     - `saveRfc(employee): Promise<Result<void, EmployeeRfcAlreadyRegisteredError | EmployeeInactiveError>>` — writes only `rfc`, only while ACTIVE.
     - `saveSite(employee): Promise<Result<void, EmployeeInactiveError>>` — writes only `siteId`, only while ACTIVE.
     - `saveTermination(employee): Promise<Result<void, EmployeeAlreadyTerminatedError>>` — writes `status`, `terminationDate`, `terminationReason`, only while ACTIVE.
   - Observable result: the port compiles; callers of `save` fail typecheck until steps 5–9.

4. **Mapper: column groups**
   - Files: `apps/api/src/modules/employees/infrastructure/employee.mapper.ts` (modify)
   - Do: keep `toDomain` and `toPersistence` (the insert). Add `toRfc(employee)` →
     `{ rfc: s.rfc?.value ?? null }`, `toSite(employee)` → `{ siteId: s.siteId }`,
     `toTermination(employee)` → `{ status: s.status, terminationDate: s.termination?.date ?? null, terminationReason: s.termination?.reason ?? null }`.
   - Observable result: compiles.

5. **Prisma adapter**
   - Files: `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts` (modify)
   - Do: rename `save` to `add` and make it `employee.create({ data: EmployeeMapper.toPersistence(employee) })`,
     keeping the unique-violation disambiguation of lines 49-67 unchanged. Add `saveRfc`,
     `saveSite` and `saveTermination`, each
     `employee.updateMany({ where: { id: employee.id, status: 'ACTIVE' }, data: EmployeeMapper.toX(employee) })`;
     when `count === 0` return the error of step 3 (`EmployeeInactiveError(employee.id)` /
     `EmployeeAlreadyTerminatedError(employee.id)`) with a Spanish comment: the row was just
     read, so 0 rows means it was terminated meanwhile. `saveRfc` catches `isUniqueViolation` →
     `EmployeeRfcAlreadyRegisteredError(rfc)` (the RFC is the only unique column it writes).
   - Observable result: compiles; integration suite runs after step 9.

6. **In-memory adapter**
   - Files: `apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts` (modify)
   - Do: keep the public `employees` map and `findById` returning the stored instance (tests
     rely on both). Add a private `persistedStatus = new Map<string, EmployeeStatus>()`.
     `add` = today's `save` duplicate checks (lines 31-45), then store the instance and
     `persistedStatus.set(id, snapshot.status)`. `saveRfc`: persisted status not ACTIVE →
     `EmployeeInactiveError`; RFC owned by another stored employee → `EmployeeRfcAlreadyRegisteredError`;
     else store. `saveSite`: persisted status not ACTIVE → `EmployeeInactiveError`; else store.
     `saveTermination`: persisted status not ACTIVE → `EmployeeAlreadyTerminatedError`; else store and
     set persisted status `TERMINATED`. Comment why the separate map exists (emulates the
     conditional `updateMany` although the instance is shared).
   - Observable result: compiles.

7. **Commands**
   - Files: `apps/api/src/modules/employees/application/commands/register-employee.command.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-site.command.ts` (modify), `apps/api/src/modules/employees/application/commands/terminate-employee.command.ts` (modify)
   - Do: `RegisterEmployee` line 91 → `add`. `AssignEmployeeRfc` line 45 → `saveRfc`.
     `AssignEmployeeSite` line 51: `const assigned = employee.assignSite(...); if (!assigned.ok) return assigned;`,
     then line 53 → `saveSite`. `TerminateEmployee` line 46 → `saveTermination`. In all four,
     publish events only after an `ok` write (as today). Error order stays: in
     `AssignEmployeeSite`, company and sede validation run before the domain rule; in
     `AssignEmployeeRfc`, `existsByRfc` runs before it.
   - Observable result: `pnpm typecheck` passes for `src/`.

8. **Facade untouched; DI untouched** — verify only
   - Files: `apps/api/src/modules/employees/application/employees.facade.ts` (modify)
   - Do: it only calls `findById` (`employees.facade.ts:40`); no change expected. If typecheck
     shows otherwise, record a deviation.
   - Observable result: no diff in this file.

9. **Adapt existing tests mechanically**
   - Files: `apps/api/src/modules/employees/application/employees.facade.test.ts` (modify), `apps/api/tests/invitations.test.ts` (modify), `apps/api/tests/password-resets.test.ts` (modify), `apps/api/tests/employee-rfc.test.ts` (modify), `apps/api/tests/attendance-attribution.test.ts` (modify), `apps/api/tests/attendance-device-sync.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `apps/api/tests/integration/attendance/employees-punch-owner-directory.int.test.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-site.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/src/modules/employees/application/commands/terminate-employee.command.test.ts` (modify)
   - Do: replace each `save(x)` by the targeted write that matches what the test did to `x`
     since it was last stored: first store of an aggregate → `add`; after `terminate` →
     `saveTermination`; after `assignRfc` or a `restore` that only changes `rfc` →
     `saveRfc`; after `assignSite` → `saveSite`; a `save` expected to hit a unique conflict on a
     new aggregate → `add`. `vi.spyOn(repository, 'save')` becomes a spy on the write the
     command now calls. Assertions do not change; if one would have to, stop and record a
     deviation.
   - Observable result: `pnpm check` and `pnpm test:integration` green.

10. **More tests tied to `save` or to the error lists** (added by the implementer: Deviations
    1–2)
    - Files: `apps/api/tests/employee-site.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify)
    - Do: same mechanical rule as step 9; update the pinned 422 description of `PUT …/site`.
    - Observable result: suites green.

## Acceptance criteria

- [ ] All existing employees flows behave as before for ACTIVE colaboradores: register (201),
      `PUT …/rfc` (204), `PUT …/site` (204), termination (204), directory unchanged.
- [ ] `PUT …/site` and `PUT …/rfc` on a TERMINATED colaborador → **422** `EMPLOYEE_INACTIVE` with
      `details.employeeId`; the row keeps its termination; no event is published.
- [ ] After a termination, a sede change that read the row before it (simulated in a test with a
      stale aggregate) cannot bring back `status: ACTIVE` nor clear `termination_date` /
      `termination_reason`: the write answers `EMPLOYEE_INACTIVE`.
- [ ] Two terminations of the same ACTIVE colaborador, the second from a stale aggregate: one
      204, the other 422 `EMPLOYEE_ALREADY_TERMINATED`; exactly one `EMPLOYEE_TERMINATED` is
      published.
- [ ] `EmployeeRepository` has no whole-row `save`; `rg "employeeRepository.save|repository.save\(" apps/api` finds no employees calls.
- [ ] `/api/v1/openapi.json` lists 422 `EMPLOYEE_INACTIVE` on both PUT routes.
- [ ] `pnpm check` and `pnpm test:integration` pass.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                                   |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `assignSite` / `assignRfc` on TERMINATED → `EMPLOYEE_INACTIVE` first, no change, no event.                                                                              |
| application | yes     | The commands call the targeted write; err from the write is returned and nothing is published.                                                                          |
| contract    | yes     | Both PUT routes document `{ EMPLOYEE_INACTIVE, variant: employees }`.                                                                                                   |
| http        | yes     | 422 `EMPLOYEE_INACTIVE` on both PUTs after a termination; ACTIVE flows unchanged.                                                                                       |
| integration | yes     | Each targeted write touches only its columns; stale site/RFC write after a termination → err and row intact; stale second termination → err; `saveRfc` unique conflict. |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                             |

## Deviations

Implemented inline in the main session (2026-10-12), on branch
`feat/employees-escrituras-dirigidas` (cut from `origin/main` after PR #19 was merged).

1. **Three more test files than step 9 listed** (cosmetic): `tests/employee-site.test.ts:163`
   (re-stores a `restore` with `siteId: null` → `saveSite`), `tests/http.test.ts:215` (spy on
   `save` during registration → `add`), and `packages/contracts/src/openapi.test.ts:403`, which
   pins the 422 description of `PUT …/site` (now
   `SITE_INACTIVE, SITE_COUNTRY_MISMATCH, EMPLOYEE_INACTIVE`). Declared in step 10.
2. **Two assertions had to change** (step 9 said none would). The tests "propaga el fallo de
   save" in `assign-employee-site.command.test.ts:159-170` and
   `terminate-employee.command.test.ts:164-179` mocked the write returning
   `EmployeeAlreadyExistsError`, which `saveSite` / `saveTermination` can no longer return by
   type. They now mock the only error each write can return (`EmployeeInactiveError`,
   `EmployeeAlreadyTerminatedError`) and assert that code. What they check (the write's err is
   propagated and nothing is published) is unchanged.
3. **Step 8 produced no diff**, as expected: `employees.facade.ts` only calls `findById`.

Mechanical conversion of step 9: every first store → `add`; after `terminate` →
`saveTermination` (`prisma-employee.int.test.ts:73,291,401,458,522,557`,
`employees-punch-owner-directory.int.test.ts:96`, `attendance-attribution.test.ts:236`,
`attendance-device-sync.test.ts:423`); after `assignRfc` and the "re-save its own RFC" case →
`saveRfc` (`prisma-employee.int.test.ts:205,214,225`); after `assignSite` → `saveSite`
(`prisma-employee.int.test.ts:347,364`).

Evidence: `pnpm check` green; `pnpm test:integration` 17 files / 222 tests passed; no
`employeeRepository.save` left in `apps/api`.

## Test coverage

## Review findings

## Verification
