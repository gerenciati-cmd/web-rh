---
status: verify
module: employees
min_implementer: mid
depends_on: []
---

# 001 — RFC of the colaborador

## Context

**What exists today:**

- The colaborador record has a personal `nationalId` (CURP in Mexico) and no RFC:
  `EmployeeProps` (`apps/api/src/modules/employees/domain/employee.ts:18-27`), `Employee.hire`
  (`employee.ts:44-84`), `Employee.restore` (`:86-88`), `snapshot` (`:105-107`); table
  `employees.employees` (`apps/api/prisma/schema.prisma`, model `Employee`, unique
  `[companyId, nationalIdCountry, nationalIdNumber]`). The localization series decided "RFC and NSS
  come later" (`plans/platform-localizacion/README.md:30`).
- Only the **company** RFC (persona moral, 12 chars) is validated:
  `RFC_MORAL_FORMAT = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/` plus a real-date check, no check digit
  (`packages/domain/src/tax-id/validators.ts:6-19`); the date helper `isValidYymmdd` is private
  (`validators.ts:21-30`). Normalization: `normalizeIdentifier` (`packages/domain/src/country.ts:26-28`).
  `TaxId` is the value-object shape to imitate (`packages/domain/src/tax-id/tax-id.ts:17-50`).
- Hire flow: contract `RegisterEmployeeSchema` with a `refine` that reuses the domain rule
  (`packages/contracts/src/employees/employee.contract.ts:24-37`); command `RegisterEmployee`
  checks the employer, builds `NationalId`/`Email`, rejects a duplicate CURP in the company with
  `EmployeeAlreadyExistsError`, hires, saves, publishes
  (`apps/api/src/modules/employees/application/commands/register-employee.command.ts:15-24`, `:37-71`).
- Persistence: `PrismaEmployeeRepository.save` maps **any** unique violation to
  `EmployeeAlreadyExistsError` (`apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:31-47`);
  port `apps/api/src/modules/employees/domain/employee.repository.ts:1-11`; mapper
  `apps/api/src/modules/employees/infrastructure/employee.mapper.ts:8-43`; in-memory
  `infrastructure/in-memory/in-memory-employee.repository.ts:7-35`.
- Reads: `EmployeeListItemSchema` (`employee.contract.ts:10-20`), `PrismaEmployeeQueries.listDirectory`
  (`apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts:19-77`), and a
  hand-written in-memory `employeeQueries` in `apps/api/tests/test-app.ts:83-103`.
- Public API to other modules: `EmployeesApi.findEmployee` only
  (`apps/api/src/modules/employees/application/employees.facade.ts:9-40`, exported in
  `apps/api/src/modules/employees/index.ts:1-4`).
- Routes: `employeeRoutes` (`employee.contract.ts:48-67`), router
  (`apps/api/src/modules/employees/http/employees.router.ts:9-24`). No route edits a colaborador.
- Permissions: `PERMISSIONS` (`packages/domain/src/identity/access.ts:6-20`); HR's list
  (`apps/api/src/modules/identity/domain/role-catalog.ts:16-29`). A 204 route uses
  `response: z.undefined(), successStatus: 204` (`packages/contracts/src/identity/access.contract.ts:68-75`).
- Error categories: `NotFoundError` → 404, `ConflictError` → 409,
  `BusinessRuleViolationError` → 422 (`apps/api/src/http/error-handler.ts:26-29`).
- Callers that hire Mexican colaboradores without RFC today (they break once it is required):
  `apps/api/prisma/seed.ts:44-69`, and the tests listed in Step 7.

**What we need** (README decisions 1–4): the personal RFC on the colaborador, required for
Mexico at hire, settable afterwards, unique across the holding, and a lookup by RFC in the
public API for `attendance-marcaciones/002`.

**Approach.** A `PersonalRfc` value object in the shared kernel (the contract validates with the
same rule, as `TaxId` does), an optional `rfc` prop on `Employee` with the country rule inside
the aggregate, a nullable unique column (existing rows have no RFC; Postgres allows many NULLs in
a unique index), and a dedicated command + `PUT` route to set it. Alternative considered: making
the column `NOT NULL` with a backfill — impossible, the RFC cannot be derived (README, discarded).
Uniqueness is checked in the command and, as last defense, by the unique index; on a unique
violation the repository disambiguates CURP vs RFC by asking `existsByRfc`, because the generic
`isUniqueViolation` (`apps/api/src/infrastructure/database/prisma-errors.ts:1-4`) does not say
which index failed.

## Out of scope

- Any attendance change (that is `attendance-marcaciones/002`).
- RFC/CURP consistency checks (first 10 chars), RFC check digit, NSS.
- Editing other fields of the colaborador; removing an RFC once set.
- DO/CO personal tax ids (README decision 5). Web or mobile screens.
- Rehiring or transferring a person between companies (blocked de facto by decision 4; not
  designed here).

## Dependencies

None.

## Steps

1. **`PersonalRfc` value object**
   - Files: `packages/domain/src/tax-id/personal-rfc.ts` (create), `packages/domain/src/tax-id/validators.ts` (modify), `packages/domain/src/index.ts` (modify)
   - Do: in `validators.ts` export `isValidYymmdd` (no behavior change). In `personal-rfc.ts`:
     `PERSONAL_RFC_FORMAT = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/`; class `PersonalRfc` (shape of
     `TaxId`, `tax-id.ts:17-50`) with `readonly value`, `static create(raw)` →
     `Result<PersonalRfc, InvalidValueError>` (normalize with `normalizeIdentifier`; valid iff
     format matches and `isValidYymmdd(normalized.slice(4, 10))`; error message
     `'RFC de persona física inválido'`, details `{ value: raw }`), `static isValid(raw): boolean`,
     `equals(other)`. Docblock in Spanish: persona física, 13 chars, no check digit for the same
     reason as `validators.ts:9-11`. Export from `index.ts` (`export * from './tax-id/personal-rfc';`
     next to the tax-id exports).
   - Observable result: `PersonalRfc.create('goma850101ab1')` is ok with value `GOMA850101AB1`;
     `PersonalRfc.isValid('GOMA851301AB1')` is `false` (month 13); `'EKU9003173C9'` (12 chars) is
     `false`.

2. **Permission**
   - Files: `packages/domain/src/identity/access.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify)
   - Do: add `'employees:update'` after `'employees:register'` in `PERMISSIONS`; add it to HR's
     list after `'employees:register'`. In the two tests, only update the expected HR permission
     list / HR grant counts by +1 (same kind of edit as `attendance-marcaciones/001` Deviation 2).
   - Observable result: `pnpm --filter @rrhh/api test role-catalog session-authenticator` passes.

3. **Contracts**
   - Files: `packages/contracts/src/employees/employee.contract.ts` (modify), `packages/contracts/openapi.json` (modify)
   - Do:
     - `EmployeeListItemSchema`: add `rfc: z.string().nullable()` after `nationalId`.
     - `RegisterEmployeeSchema`: add `rfc: z.string().trim().optional()` to the object; add a
       second `.refine` (after the `NationalId` one) with `path: ['rfc']`: when
       `nationalId.country === 'MX'` the `rfc` must be present and `PersonalRfc.isValid(rfc)`
       (message `'RFC obligatorio y válido para colaboradores de México'`); otherwise `rfc` must
       be absent (message `'El RFC solo aplica a colaboradores de México'`).
     - `AssignEmployeeRfcSchema = z.object({ rfc: z.string().trim().refine(PersonalRfc.isValid,
'RFC de persona física inválido') }).meta({ id: 'AssignEmployeeRfcInput' })`, exported with
       its `z.input` type.
     - Route `assignEmployeeRfc`: `PUT /companies/:companyId/employees/:employeeId/rfc`, summary
       `'Captura o corrige el RFC de un colaborador'`,
       `access: requires('employees:update', { companyParam: 'companyId' })`,
       `params: z.object({ companyId: z.uuid(), employeeId: z.uuid() })`,
       `body: AssignEmployeeRfcSchema`, `response: z.undefined()`, `successStatus: 204`.
     - Regenerate: `pnpm --filter @rrhh/contracts openapi`.
   - Observable result: `pnpm --filter @rrhh/contracts typecheck` passes; `openapi.json` has the
     `PUT …/rfc` operation.

4. **Domain**
   - Files: `apps/api/src/modules/employees/domain/employee.ts` (modify), `apps/api/src/modules/employees/domain/errors.ts` (modify), `apps/api/src/modules/employees/domain/employee.repository.ts` (modify)
   - Do, `employee.ts`: add `rfc: PersonalRfc | null` to `EmployeeProps`. `hire` input gets
     `rfc?: PersonalRfc | undefined`; before building: if `nationalId.country === 'MX'` and no
     `rfc` → `err(new InvalidValueError('El RFC es obligatorio para colaboradores de México'))`;
     if country is not `'MX'` and `rfc` given →
     `err(new InvalidValueError('El RFC solo aplica a colaboradores de México'))`. Store
     `rfc ?? null`. New method `assignRfc(rfc: PersonalRfc): Result<void, BusinessRuleViolationError>`:
     not `'MX'` → `err(new RfcNotApplicableError())`; else set it. No event (no consumer).
   - Do, `errors.ts`: `EmployeeNotFoundError extends NotFoundError` (`'EMPLOYEE_NOT_FOUND'`,
     `'El colaborador no existe'`, details `{ employeeId }`);
     `EmployeeRfcAlreadyRegisteredError extends ConflictError` (`'EMPLOYEE_RFC_ALREADY_REGISTERED'`,
     `'Ya hay un colaborador registrado con ese RFC'`, details `{ rfc }`);
     `RfcNotApplicableError extends BusinessRuleViolationError` (`override readonly code =
'RFC_NOT_APPLICABLE'`, `'El RFC solo aplica a colaboradores de México'`).
   - Do, `employee.repository.ts`: add `existsByRfc(rfc: PersonalRfc, exceptId?: EmployeeId):
Promise<boolean>`; `save` returns
     `Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>`.
   - Observable result: `pnpm --filter @rrhh/api typecheck` reports only the call sites Steps
     5–7 fix.

5. **Application**
   - Files: `apps/api/src/modules/employees/application/commands/register-employee.command.ts` (modify), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.ts` (create), `apps/api/src/modules/employees/application/queries/employee.queries.ts` (modify), `apps/api/src/modules/employees/application/employees.facade.ts` (modify)
   - Do, `RegisterEmployee`: input gets `rfc?: string | undefined`. After `Email.create`, if
     `input.rfc` → `PersonalRfc.create` (return its error). Keep the CURP-per-company check
     first (`register-employee.command.ts:49-51`, so the duplicate-CURP case keeps
     `EMPLOYEE_ALREADY_EXISTS`); then, if there is an RFC and `existsByRfc(rfc)` →
     `err(new EmployeeRfcAlreadyRegisteredError(rfc.value))`. Pass `rfc` to `Employee.hire`.
   - Do, `AssignEmployeeRfc` (shape of `RegisterEmployee`): input `{ companyId, employeeId, rfc }`,
     deps `employeeRepository`. Steps: `PersonalRfc.create`; `findById`; missing or
     `snapshot.companyId !== companyId` → `EmployeeNotFoundError` (do not reveal other
     companies); `existsByRfc(rfc, employee.id)` → `EmployeeRfcAlreadyRegisteredError`;
     `employee.assignRfc(rfc)`; `save`; `ok(undefined)`. Idempotent when the same RFC is set again.
   - Do, `employee.queries.ts`: add to `EmployeeQueries`
     `findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]>` and
     `rfcsInCompanies(companyIds: readonly string[]): Promise<string[]>`, with
     `interface EmployeeRfcOwner { id; companyId; fullName; rfc: string; active: boolean }`
     (docblock: consumer is `attendance-marcaciones/002`; both ignore colaboradores without RFC).
   - Do, `employees.facade.ts`: add `rfc: string | null` to `EmployeeSummary` (and fill it in
     `findEmployee`); add to `EmployeesApi` and `EmployeesFacade`
     `findByRfcs(rfcs)` and `rfcsInCompanies(companyIds)`, delegating to a new dep
     `employeeQueries: EmployeeQueries`. Export `EmployeeRfcOwner` from
     `apps/api/src/modules/employees/index.ts` (Step 6 file list).
   - Observable result: typecheck passes for these files.

6. **Persistence, HTTP and module**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261002120000_add_employee_rfc/migration.sql` (create), `apps/api/src/modules/employees/infrastructure/employee.mapper.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts` (modify), `apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts` (modify), `apps/api/src/modules/employees/infrastructure/in-memory/in-memory-employee.repository.ts` (modify), `apps/api/src/modules/employees/http/employees.router.ts` (modify), `apps/api/src/modules/employees/employees.module.ts` (modify), `apps/api/src/modules/employees/index.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do, schema (recipe `db-change`): in `Employee` add
     `rfc String? @unique @db.VarChar(13)` with `/// RFC persona física (solo MX), único en el holding`.
     `pnpm db:migrate --name add_employee_rfc`; SQL must be an `ALTER TABLE … ADD COLUMN` plus a
     unique index, no `DROP`. Replace the placeholder in this `Files:` line with the real folder
     and note it in Deviations.
   - Do, mapper: `toDomain` builds `PersonalRfc.create(row.rfc)` when not null (throw on invalid,
     like `nationalId`); `toPersistence` writes `rfc: s.rfc?.value ?? null`.
   - Do, `PrismaEmployeeRepository`: `existsByRfc` = `count({ where: { rfc: rfc.value,
...(exceptId ? { id: { not: exceptId } } : {}) } }) > 0`. In `save`'s unique-violation
     branch: if the employee has an RFC and `await this.existsByRfc(rfc, employee.id)` → return
     `EmployeeRfcAlreadyRegisteredError`, else the current `EmployeeAlreadyExistsError`.
   - Do, `PrismaEmployeeQueries`: `listDirectory` selects and returns `rfc`; `findByRfcs` (empty
     input → `[]`; `findMany({ where: { rfc: { in: [...rfcs] } } })`, mapped to
     `EmployeeRfcOwner`, `active = status === 'ACTIVE'`); `rfcsInCompanies` (empty → `[]`;
     `findMany({ where: { companyId: { in }, rfc: { not: null } }, select: { rfc: true } })`).
   - Do, in-memory repository: `existsByRfc` and RFC duplicate detection in `save` mirroring the
     Prisma behavior. `test-app.ts`: the hand-written `employeeQueries` (`:83-103`) returns `rfc`
     in list items and implements `findByRfcs`/`rfcsInCompanies` over the same in-memory store.
   - Do, router: `bindRoute(router, routes.assignEmployeeRfc, async ({ params, body }) =>
unwrap(await deps.assignEmployeeRfc.execute({ ...params, rfc: body.rfc })))`.
     `employees.module.ts`: register `assignEmployeeRfc: asClass(AssignEmployeeRfc).singleton()`
     in cradle and registrations.
   - Observable result: migration applied; `pnpm --filter @rrhh/api typecheck` passes.

7. **Existing callers: seed and tests**
   - Files: `apps/api/prisma/seed.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `packages/contracts/src/employees/employee.contract.test.ts` (modify), `packages/contracts/src/openapi.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `apps/api/tests/authorization.test.ts` (modify), `apps/api/tests/invitations.test.ts` (modify), `apps/api/tests/password-resets.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `packages/domain/src/tax-id/personal-rfc.test.ts` (create), `apps/api/src/modules/employees/application/commands/assign-employee-rfc.command.test.ts` (create), `apps/api/src/modules/employees/application/employees.facade.test.ts` (create), `apps/api/tests/employee-rfc.test.ts` (create)
   - Do: wherever a **Mexican** colaborador is hired (HTTP body, `RegisterEmployee` input or
     `Employee.hire`), add a valid synthetic RFC whose first 10 chars match its CURP, e.g. CURP
     `GOMA850101HQRRRN04` → `GOMA850101AB1`, `PEXL900215MDFRPR07` → `PEXL900215AB2`; a different
     person/test that needs a second distinct colaborador gets a distinct homoclave
     (`…AB3`, `…AB4`). Where the same person is deliberately hired in two companies, give each
     record a different RFC (decision 4 would reject the second otherwise) and do not change
     the assertion. Seed: add `rfc` to both seed colaboradores. `openapi.test.ts`: operation
     count +1 only. Add no new test cases (the tester does).
   - Observable result: `pnpm check` passes; `pnpm test:integration` passes; `pnpm db:seed`
     runs twice without errors.

8. **Review repair** (added by the main session after review, see Deviation 7)
   - Files: `docs/adr/0009-paises-soportados-e-identificadores.md` (modify)
   - Do: dated note on the RFC line (review L3).
   - Observable result: the ADR no longer says the RFC waits for payroll.

## Acceptance criteria

- [ ] `POST /api/v1/companies/:id/employees` for an MX colaborador **without** `rfc` → 400 with
      the issue at `rfc`; with an invalid `rfc` → 400; with a valid `rfc` → 201 and the list shows
      `rfc` normalized (uppercase).
- [ ] Hiring a second colaborador (any company of the holding) with an RFC already used → 409
      `EMPLOYEE_RFC_ALREADY_REGISTERED`; the same CURP twice in one company still → 409
      `EMPLOYEE_ALREADY_EXISTS`.
- [ ] A DO or CO colaborador with an `rfc` → 400; without it → 201 with `rfc: null`.
- [ ] `PUT …/employees/:employeeId/rfc` as HR of that company → 204 and the list shows the RFC;
      the same RFC again → 204; an RFC owned by someone else → 409; an employee of another
      company or unknown id → 404 `EMPLOYEE_NOT_FOUND` for HOLDING_ADMIN, 403 for HR of another
      company; a DO/CO colaborador → 422 `RFC_NOT_APPLICABLE`; anonymous → 401.
- [ ] A colaborador created before this plan (row with `rfc` NULL) still lists, and can get its
      RFC through the `PUT`.
- [ ] `pnpm db:seed` is idempotent and the seed colaboradores have RFC.
- [ ] `/api/v1/docs` shows the new `PUT` route.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                                             |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | `PersonalRfc` (format, normalization, date, 12-char rejected); `Employee.hire` MX requires RFC, non-MX rejects it; `assignRfc`                                    |
| application | yes     | `RegisterEmployee` RFC paths (missing, invalid, duplicate, CURP check first); `AssignEmployeeRfc` all errors + idempotency; facade `findByRfcs`/`rfcsInCompanies` |
| contract    | yes     | `RegisterEmployeeSchema` RFC refine by country; `AssignEmployeeRfcSchema`; access of the new route                                                                |
| http        | yes     | the acceptance criteria above over supertest                                                                                                                      |
| integration | yes     | unique RFC index across companies, NULLs allowed, `save` disambiguation, `findByRfcs`, `rfcsInCompanies`                                                          |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                                                       |

## Deviations

1. Step 6, migration: `pnpm db:migrate` (`prisma migrate dev`) refuses to run non-interactively.
   Generated the SQL with `prisma migrate diff --from-config-datasource --to-schema` (output is
   exactly `ADD COLUMN "rfc" VARCHAR(13)` + `CREATE UNIQUE INDEX "employees_rfc_key"`, no DROP),
   wrote it by hand as `20261002120000_add_employee_rfc/migration.sql` and applied it with
   `prisma migrate deploy` to the local dev DB. The `Files:` placeholder was replaced with that
   folder. Cosmetic.
2. Step 6, `save` disambiguation order (cosmetic, kept the existing concurrency test green): the
   plan said "if the employee has an RFC and `existsByRfc` → RFC error, else CURP error". Doing so
   made the existing test `register-employee.command.test.ts` "dos comandos concurrentes" (same
   CURP and same RFC) return `EMPLOYEE_RFC_ALREADY_REGISTERED` instead of `EMPLOYEE_ALREADY_EXISTS`.
   Both `PrismaEmployeeRepository.save` and the in-memory repository now check the CURP duplicate
   in the company first (same order as the command) and only then the RFC. Test assertions were not changed.
3. Step 2/7: `role-catalog.test.ts` also had two grant counts (`grantsFor`: HR 6 to 7, two HR
   companies 12 to 14) besides the HR permission list; updated (+1 per HR grant). `test-app.ts`:
   only the `employeeQueries` double was extended; the `EmployeeDirectory` double there belongs to
   the identity module and was left alone.
4. Step 7 test fixtures: in `invitations.test.ts`, `password-resets.test.ts` and the Prisma
   integration fixture the RFC is generated per hire from the CURP prefix plus a sequence
   (`<CURP[0..10]>A01`, `A02`, ...), because the same CURP is hired several times (decision 4).
   Dev DB note: the two seed colaboradores already existing in the local dev DB keep `rfc` NULL
   (seed skips existing CURPs); a fresh DB gets the RFCs.
5. `RegisterEmployee` got a private `findDuplicate` helper (lint complexity limit); no behavior change.
   _Corrected by the main session (review L2):_ the helper alone left `execute` at complexity 13
   (limit 12, warning). A module-level `parseOptionalRfc` now brings it under the limit; `pnpm
lint` has no warnings.
6. (Review I1) `RegisterEmployeeSchema` uses `.superRefine` for the RFC rule instead of the
   plan's second `.refine`: same issues and path (`['rfc']`), one issue per case.
7. (Main session) Step 8 added to declare `docs/adr/0009-paises-soportados-e-identificadores.md`
   for the review L3 note.

## Test coverage

Added by the tester (no product code touched; no GAP or NOT CONFIRMED found). Fixtures are synthetic
(CURP/RFC sets already used by the suite; DO `00113918205`, CO `1020304050` from `national-id.test.ts`).

| Behavior (plan / code)                                                                                                                                      | Source                                      | Layer       | Test                                                                              | State                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ----------- | --------------------------------------------------------------------------------- | ------------------------- |
| `PersonalRfc` normalizes, accepts `&`/`Ñ`, rejects 12 chars, bad month/day, length, `equals`                                                                | `personal-rfc.ts:16-35`                     | domain      | `personal-rfc.test.ts`                                                            | CONFIRMED                 |
| `Employee.hire`: MX requires RFC; non-MX rejects RFC; non-MX without RFC stores null                                                                        | `employee.ts:76-81`                         | domain      | `employee.test.ts › RFC`                                                          | CONFIRMED                 |
| `assignRfc`: sets, corrects, no event, `RFC_NOT_APPLICABLE` outside MX                                                                                      | `employee.ts:120-124`                       | domain      | `employee.test.ts › RFC`                                                          | CONFIRMED                 |
| `RegisterEmployee`: normalized RFC, missing, invalid, non-MX, duplicate across companies, CURP checked first, same CURP other company other RFC             | `register-employee.command.ts:59-95`        | application | `register-employee.command.test.ts › RFC`                                         | CONFIRMED                 |
| `AssignEmployeeRfc`: capture, correct, idempotent, invalid, not found, other company -> not found, duplicate, non-MX, save conflict                         | `assign-employee-rfc.command.ts:23-47`      | application | `assign-employee-rfc.command.test.ts`                                             | CONFIRMED                 |
| Facade `findEmployee` exposes `rfc`; `findByRfcs`/`rfcsInCompanies` delegate                                                                                | `employees.facade.ts:36-56`                 | application | `employees.facade.test.ts` (delegation only; filtering is covered in integration) | CONFIRMED                 |
| `RegisterEmployeeSchema` RFC refine by country; `AssignEmployeeRfcSchema`; route access/params                                                              | `employee.contract.ts:40-56, 60-68, 98-107` | contract    | `employee.contract.test.ts`                                                       | CONFIRMED                 |
| POST hire: 201 normalized, 400 missing/invalid, 409 RFC dup (cross company), 409 CURP dup, DO/CO 201 null and 400 with RFC                                  | acceptance criteria 1-3                     | http        | `tests/employee-rfc.test.ts › POST`                                               | CONFIRMED                 |
| PUT: 204 (HR), legacy NULL row lists and gets RFC, idempotent, correct, 409, 400, 404 (admin: unknown / other company), 403 (HR other company), 422 DO, 401 | acceptance criteria 4-5                     | http        | `tests/employee-rfc.test.ts › PUT`                                                | CONFIRMED                 |
| OpenAPI documents the PUT with `x-permission: employees:update`                                                                                             | `openapi.ts:106`                            | http        | `tests/employee-rfc.test.ts › OpenAPI`                                            | CONFIRMED                 |
| Unique RFC index across companies; NULLs allowed; `save` disambiguation (CURP wins); update path; `existsByRfc` with `exceptId`                             | `prisma-employee.repository.ts:31-69`       | integration | `prisma-employee.int.test.ts › RFC en PrismaEmployeeRepository`                   | CONFIRMED                 |
| `listDirectory` returns rfc/null; `findByRfcs` (owners, unknown ignored, active flag, empty); `rfcsInCompanies` (filter, NULL ignored, empty)               | `prisma-employee.queries.ts`                | integration | `prisma-employee.int.test.ts › RFC en PrismaEmployeeQueries`                      | CONFIRMED                 |
| `pnpm db:seed` idempotent with RFC (acceptance criterion)                                                                                                   | `seed.ts`                                   | none        | not a test; belongs to the verifier                                               | NOT TESTED (verify phase) |
| 403 for HR of another company comes before 404; HR cannot probe other companies                                                                             | `authorization` wiring                      | http        | `employee-rfc.test.ts › PUT 403`                                                  | CONFIRMED                 |

Counts added: domain 11 (`PersonalRfc`, package domain) + 8 (`Employee` RFC), application 9 + 9 + 5 (register, assign,
facade), contract 18, http 20, integration 15. Closing run: `pnpm check` green (api 639 passed | 3 skipped, contracts and
domain green); `pnpm test:integration` 145 passed (baseline 130).

## Review findings

Reviewed on 2026-10-02 against commits `2f3b5a0` (implementation) and `44c8a82` (tests). The
earlier doc commits (`0d1f337`, `e70b049`, `02f2236`, `1205f38`, `22a7c00`) were excluded.

### Checklist: 10/13

- [ ] `plans:scope --base origin/main`: exits 1, but only because of 6 files from the excluded
      doc commits (ADR 0013, zkteco doc, attendance plans). Every file in the two plan commits is
      declared. **Failed item**: the hot file `schema.prisma` has a change that is not append-only
      (L1 below).
- [x] `pnpm check` passes (api 639 passed / 3 skipped, contracts 177, domain 86, arch, plans, harness).
      It shows 1 lint warning (L2).
- [x] `pnpm test:integration`: 145 passed (12 files).
- [x] Business rules are in `domain/`. The contract's country refine reuses `PersonalRfc.isValid`,
      the same pattern as `NationalId`, as the plan specifies.
- [x] CQRS-lite: `AssignEmployeeRfc` uses aggregate → repository → `Result`. `findByRfcs` and
      `rfcsInCompanies` are on `EmployeeQueries`. The repository only got `existsByRfc`, which is
      an invariant check, not a screen query.
- [x] Types come from `@rrhh/contracts`. `openapi.json` was regenerated.
- [x] Errors use stable codes (`EMPLOYEE_NOT_FOUND`, `EMPLOYEE_RFC_ALREADY_REGISTERED`,
      `RFC_NOT_APPLICABLE`). Internals don't leak.
- [x] Money, dates and IDs: nothing new.
- [x] The new migration adds the column and a unique index only, with no DROP and no cross-module FK.
- [x] DI: `assignEmployeeRfc` is registered once, and the facade gets `employeeQueries`.
      `container.test.ts` passes.
- [x] No secrets or real personal data. Fixtures are synthetic.
- [ ] `## Deviations` is not fully accurate (L2, I1). I spot-checked Deviation 2: it matches
      `prisma-employee.repository.ts:51-62`.
- [ ] A stale doc was not updated (L3).

### Findings

No Critical, High or Medium findings. The bug hunt traced POST/PUT from contract to response.
It also checked tenancy (403 from `companyParam`, then 404 for another company's employee
inside the command), concurrent hires and assigns (the unique index is disambiguated with CURP
first), legacy NULL rows and seed idempotency (the CURP check runs first, so a re-run still gets
`EMPLOYEE_ALREADY_EXISTS`). No correctness bug was found.

**Low**

- **L1** `apps/api/prisma/schema.prisma:59`: whitespace-only change to an untouched line. It
  removes one space, so the `hireDate` column is out of alignment with every other field in the
  model. Effect: the hot file is not append-only, and the next `prisma format` will produce an
  unrelated diff. There is no runtime effect. Fix: restore the original alignment.
- **L2** `apps/api/src/modules/employees/application/commands/register-employee.command.ts:48`:
  `execute` has complexity 13 (limit 12). This plan introduced it, and it is the only lint
  warning in the repo; the code at `22a7c00` had no warning. Deviation 5 says the
  `findDuplicate` helper was added for the complexity limit, but the limit is still exceeded,
  so the deviation reads as if the problem were fixed. Judgement: not a bug, but it should be
  fixed rather than accepted while the repo is otherwise warning-free. One cheap option is to
  move the `PersonalRfc` parsing (`:59-60`, ternary plus `&&`) into a helper or into
  `findDuplicate`'s caller logic. Then correct Deviation 5.
- **L3** `docs/adr/0009-paises-soportados-e-identificadores.md:35`: still says "En México el
  colaborador se registra con CURP. RFC y NSS se agregan con la nómina." That is no longer true:
  the RFC is now required at hire. The file is not in the plan's file list. The main session or
  the user must decide how to handle it, for example a deviation that adds a dated note pointing
  to `plans/employees-rfc/README.md`, or a superseding ADR. Uncertain: if ADRs are treated as
  immutable history, this may be acceptable as is, and the user should confirm.

**Info (no change required)**

- **I1** `packages/contracts/src/employees/employee.contract.ts:53`: Step 3 asked for a second
  `.refine`, and the code uses `.superRefine`. The behavior is the same, and `superRefine` is
  needed for the two different messages. This is not recorded in Deviations; add one line when
  you fix L2.
- **I2** `apps/api/src/modules/employees/infrastructure/prisma-employee.repository.ts:51-62`: the
  unique-violation branch now runs 1-2 extra queries. Today `employeeRepository.save` is never
  called inside `transactionRunner.run`, so this is safe. If it ever runs inside a transaction,
  Postgres aborts the transaction after the violation, and these queries would throw (500 instead
  of 409). This is latent only and is not a finding against this plan.

Status stays `review`. L1 and L2 need small in-scope code changes. L3 needs a scope decision.

### Resolution (main session, 2026-10-02)

- **L1 fixed**: `hireDate` alignment restored in `schema.prisma`; `prisma format` leaves it as is.
- **L2 fixed**: `parseOptionalRfc` helper in `register-employee.command.ts`; Deviation 5 corrected.
- **L3 fixed**: dated "Actualización" note in ADR 0009 (decision: an amendment note, not a new
  ADR, since only one sentence of 0009 changes); declared in Step 8.
- **I1** recorded as Deviation 6. **I2** acknowledged, no change (no transaction wraps `save`).

Plan to `verify`.

## Verification
