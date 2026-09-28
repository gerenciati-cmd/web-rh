---
status: testing
module: platform
min_implementer: mid
depends_on: []
---

# 001 — Countries MX/DO/CO: company tax ID and personal ID

## Context

**What exists today.**

- `packages/domain/src/national-id/validators.ts:16`: `CountryCode = 'CL' | 'PE'`. The only
  validators are the Chilean RUT (`:19-48`) and the Peruvian DNI (`:51-56`). The registry is
  `NATIONAL_ID_VALIDATORS` (`:58-61`) and `SUPPORTED_COUNTRIES` (`:63`). The interface
  `NationalIdValidator` is at `:7-14`.
- `packages/domain/src/national-id/national-id.ts:10-38`: the `NationalId` value object delegates
  to the registry (Strategy pattern). The domain index re-exports both files
  (`packages/domain/src/index.ts:8-9`).
- One `NationalId` type serves two different concepts:
  - The company tax ID: `apps/api/src/modules/organization/domain/company.ts:16` (`taxId:
NationalId`), `company.repository.ts:12`, `create-company.command.ts:31`,
    `company.mapper.ts:14` and `:40`, `prisma-company.repository.ts:1` and `:20-22`, and
    `in-memory/in-memory-company.store.ts:2` and `:25-35`.
  - The colaborador ID: `apps/api/src/modules/employees/domain/employee.ts:20`,
    `register-employee.command.ts:17` and `:44`, `employee.mapper.ts:9-12`,
    `prisma-employee.queries.ts:59-62` and `employee.repository.ts:8`.
- Contracts: `CountrySchema` is derived from `SUPPORTED_COUNTRIES`
  (`packages/contracts/src/common.ts:36`). `CreateCompanySchema` refines with `NationalId.isValid`
  (`organization/company.contract.ts:25-29`), and so does `RegisterEmployeeSchema`
  (`employees/employee.contract.ts:29-32`). The directory example says
  `12.345.678-5` (`employee.contract.ts:13`).
- The directory search matches the ID with `contains`, after stripping `.`, `-` and spaces. The
  match is **case-sensitive** (`prisma-employee.queries.ts:30`). That is irrelevant for the RUT,
  but a CURP is alphanumeric.
- Persistence: `taxId` is `VarChar(20)` and `country` is `Char(2)`
  (`apps/api/prisma/schema.prisma`, model `Company`). `nationalIdCountry` is `Char(2)` and
  `nationalIdNumber` is `VarChar(20)` (model `Employee`). Every new identifier fits: the longest
  is the CURP, at 18 characters. **No schema change or migration.**
- Chilean fixtures and examples are listed in step 6 and in finding
  `plans/hallazgos/platform-localizacion-mexico.md`.

**Chosen approach.** Two options were compared.

- (a) Keep one `NationalId` and add a `kind` discriminator (company or person).
- (b) Two value objects with the same Strategy shape: `TaxId` for the company (RFC persona moral,
  RNC, NIT) and `NationalId` for the person (CURP, cédula DO, cédula CO). They share a
  `CountryCode` and a validator interface.

(b) is chosen. The type system then prevents passing a CURP where a company RFC is expected, and
each registry is a `Record<CountryCode, …>`, so the compiler forces every country to have both
validators. `NationalId` keeps its name and API, so the employees module only changes
fixtures. The organization module switches from `NationalId` to `TaxId`. Shape imitated:
`packages/domain/src/national-id/*` (as it is today). Decisions 1–3 of the README apply.

**Identifier rules (external facts).** The reference implementation is python-stdnum
(`stdnum/mx/curp.py`, `mx/rfc.py`, `do/rnc.py`, `do/cedula.py` and `co/nit.py` at
<https://github.com/arthurdejong/python-stdnum>). Only the algorithm is reimplemented. **No code
or data is copied**: the library is LGPL.

The algorithms below were checked on 2026-09-28 against that library's own examples. They
yielded CURP `BOXW310820HNERXN09` → 9, NIT `213123432` → 1, and RNC `13124679` → 6 and
`10185004` → 3. The cédula `00113918205` passes Luhn.

| Country | Kind    | Document             | Normalized form                     | Validation in this plan                                                                                   |
| ------- | ------- | -------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| MX      | company | RFC persona moral    | 12 chars, uppercase                 | Format `^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$` and a real calendar date in chars 4–9 (YYMMDD). **No check digit.** |
| MX      | person  | CURP                 | 18 chars, uppercase                 | Format, real birth date, state code, check digit (see below)                                              |
| DO      | company | RNC                  | 9 digits                            | `^\d{9}$`. **No check digit.**                                                                            |
| DO      | person  | Cédula               | 11 digits                           | `^\d{11}$`. **No Luhn.**                                                                                  |
| CO      | company | NIT (with DV)        | 8–16 digits, the last one is the DV | Digits only, 8–16 long, DV check (see below)                                                              |
| CO      | person  | Cédula de ciudadanía | 3–10 digits                         | `^\d{3,10}$` (no check digit exists)                                                                      |

Why the check digit is skipped for RFC, RNC and cédula DO: python-stdnum documents that about
1.5 % of real RFCs carry an invalid check digit, and it disables that check by default. It also
whitelists about 1,500 real cédulas that fail Luhn and 23 real RNCs that fail their check.
Enforcing those checks would reject real people and companies. Any whitelist is out of scope.

- **CURP** (18 characters). The format regex is
  `^[A-Z][A-Z]{3}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d$`, with the rules below:
  - **Birth date:** chars 5–10 are YYMMDD. The century comes from char 17: a digit means 19YY, a
    letter means 20YY. The date must exist in the calendar, so `310230` fails.
  - **Sex:** char 11 is `H` or `M`, as in python-stdnum.
  - **State code:** chars 12–13 must be one of `AS BC BS CC CH CL CM CS DF DG GR GT HG JC MC MN
MS NE NL NT OC PL QR QT SL SP SR TC TL TS VZ YN ZS`. `NE` means born abroad.
  - **Check digit:** alphabet `0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ`. The sum is `index(c_i) × (18 − i)`
    for i = 0…16. DV = `(10 − sum % 10) % 10` and must equal char 18.
- **NIT DV.** The weights are `3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71`, applied to
  the body digits read from right to left. With `s = sum % 11`, DV = `'01987654321'[s]`.
- **Normalization.** Every validator strips `.`, `-` and whitespace and uppercases the value,
  keeping `Ñ` and `&`.
- **Display format.** RFC and CURP are shown as stored. RNC is `X-XX-XXXXX-X`. Cédula DO is
  `XXX-XXXXXXX-X`. NIT groups the body in threes from the right with dots, then adds `-DV`
  (`213.123.432-1`). Cédula CO groups in threes with dots (`1.020.304.050`).

**Synthetic fixtures** (computed with the algorithms above; not real people):

| Use                             | Value                                                    |
| ------------------------------- | -------------------------------------------------------- |
| MX company RFC                  | `EKU9003173C9` (SAT's public test RFC), `AAA010101AAA`   |
| MX CURP (born 1985, male, QR)   | `GOMA850101HQRRRN04`                                     |
| MX CURP (born 1990, female, DF) | `PEXL900215MDFRPR07`                                     |
| MX CURP (born 2001, QR)         | `ROSA010305HQRDNLA3`                                     |
| MX CURP with wrong DV           | `GOMA850101HQRRRN05`                                     |
| DO RNC                          | `131246796`                                              |
| DO cédula                       | `00113918205`                                            |
| CO NIT                          | `900123456-8` (display `900.123.456-8`), `213.123.432-1` |
| CO NIT with wrong DV            | `900123456-9`                                            |
| CO cédula                       | `1020304050`                                             |

## Out of scope

- RFC, NSS or any second identifier for persons (decision 2). Payroll adds them.
- Time zone per site or device (next plan in this series).
- Requiring the colaborador's ID country to match the company's country. The current behaviour
  is kept.
- Check-digit whitelists, and any validation beyond the table in Context.
- Deleting or migrating dev data (decision 3: the user does it by hand).
- Editing accepted ADRs `0001` and `0004`, which mention RUT as a historical example. They are
  immutable, and the new ADR 0009 supersedes the country assumption.
- Web and mobile UI changes. They only display `taxId` and `country` as strings
  (`apps/web/src/features/organization/components/company-table.tsx:23-24`,
  `apps/mobile/src/app/empresas.tsx:34`). Only their test fixtures change.
- Labor or legal rules of any country.

## Dependencies

None

## Steps

1. **Country list and shared validator interface**
   - Files: `packages/domain/src/country.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do: `country.ts` exports:
     - `SUPPORTED_COUNTRIES = ['MX', 'DO', 'CO'] as const`;
     - `type CountryCode = (typeof SUPPORTED_COUNTRIES)[number]`;
     - `interface IdentifierValidator { readonly country: CountryCode; normalize(raw): string; isValid(normalized): boolean; format(normalized): string }`,
       with the docblocks moved from `validators.ts:7-14`;
     - `normalizeIdentifier(raw: string): string`, which strips `.`, `-` and whitespace, then
       uppercases.

     A docblock says that supported countries are decided in ADR 0009. In `index.ts`, add
     `export * from './country';`, then `export * from './tax-id/tax-id';` and
     `export * from './tax-id/validators';`.

   - Observable result: `pnpm --filter @rrhh/domain typecheck` passes once steps 2–3 exist.

2. **Personal ID validators (`NationalId`)**
   - Files: `packages/domain/src/national-id/validators.ts` (modify), `packages/domain/src/national-id/national-id.ts` (modify), `packages/domain/src/national-id/national-id.test.ts` (modify)
   - Do:
     - **`validators.ts`:** delete the Chile and Peru validators, `computeRutVerifier` and the
       local `CountryCode`/interface. Import `CountryCode`, `IdentifierValidator` and
       `normalizeIdentifier` from `../country`. Add three validators, following the Context table:
       `mexicanCurpValidator` (including `isValidCurpDate` and `curpCheckDigit` helpers),
       `dominicanCedulaValidator` and `colombianCedulaValidator`. Each validator's docblock
       names the python-stdnum module it follows, or states that the document has no check
       digit. The skipped checks carry the 1.5 % / 1,500 reason as a one-line comment.
     - **The registry:** `NATIONAL_ID_VALIDATORS: Readonly<Record<CountryCode, IdentifierValidator>>`
       gets `MX`, `DO` and `CO`. Remove the old `SUPPORTED_COUNTRIES` export, which now lives in
       `country.ts`. Keep the name `NationalIdValidator` as a type alias of
       `IdentifierValidator`, so existing imports keep compiling.
     - **`national-id.ts`:** import `CountryCode` from `../country`. The docblock becomes
       "Documento de identidad de una persona (CURP, cédula…)". The API does not change.
     - **`national-id.test.ts`:** replace the Chile/Peru blocks with one `it` per country that
       accepts a Context fixture, plus one `it` that rejects the wrong-DV CURP. The full matrix is
       the tester's job.
   - Observable result: `NationalId.create('MX', 'goma850101hqrrrn04')` is ok, with value
     `GOMA850101HQRRRN04`. `NationalId.create('MX', 'GOMA850101HQRRRN05')` is err.

3. **Company tax ID (`TaxId`)**
   - Files: `packages/domain/src/tax-id/validators.ts` (create), `packages/domain/src/tax-id/tax-id.ts` (create)
   - Do:
     - **`validators.ts`:** `mexicanRfcMoralValidator`, `dominicanRncValidator` and
       `colombianNitValidator` (with an `nitCheckDigit` helper), following the Context table.
       Registry `TAX_ID_VALIDATORS: Readonly<Record<CountryCode, IdentifierValidator>>`.
     - **`tax-id.ts`:** class `TaxId`, a copy of `NationalId`'s shape (`national-id.ts:10-38`):
       `create`, `isValid`, `format` and `equals`. Error:
       `new InvalidValueError('Identificador tributario inválido', { country, value: raw })`.
       Docblock: "Identificador tributario de una empresa (RFC persona moral, RNC, NIT)".
   - Observable result: `TaxId.create('CO', '900.123.456-8')` is ok, with value `9001234568`
     and format `900.123.456-8`. `TaxId.create('CO', '900123456-9')` is err.
     `TaxId.create('MX', 'EKU9003173C9')` is ok.

4. **Contracts**
   - Files: `packages/contracts/src/common.ts` (modify), `packages/contracts/src/organization/company.contract.ts` (modify), `packages/contracts/src/employees/employee.contract.ts` (modify)
   - Do:
     - **`common.ts:36`:** `export const CountrySchema = z.enum(SUPPORTED_COUNTRIES);`. Drop the
       cast and the `CountryCode` import if it is now unused.
     - **`company.contract.ts`:** import `TaxId` instead of `NationalId`, and refine with
       `TaxId.isValid(input.country, input.taxId)`. The message stays the same.
     - **`employee.contract.ts:13`:** the example becomes `'Formateado para mostrar, p. ej. GOMA850101HQRRRN04'`.
   - Observable result: `pnpm --filter @rrhh/contracts typecheck` passes.

5. **Organization module uses `TaxId`**
   - Files: `apps/api/src/modules/organization/domain/company.ts` (modify), `apps/api/src/modules/organization/domain/company.repository.ts` (modify), `apps/api/src/modules/organization/application/commands/create-company.command.ts` (modify), `apps/api/src/modules/organization/infrastructure/company.mapper.ts` (modify), `apps/api/src/modules/organization/infrastructure/prisma-company.repository.ts` (modify), `apps/api/src/modules/organization/infrastructure/in-memory/in-memory-company.store.ts` (modify)
   - Do: replace every `NationalId` with `TaxId` in the lines cited in Context. This is only a
     type and constructor swap: `TaxId.create(...)` at `create-company.command.ts:31` and
     `company.mapper.ts:14,40`, plus `type TaxId` in the other files. No logic changes.
   - Observable result: `pnpm --filter @rrhh/api typecheck` passes, and `arch:check` is green.

6. **Directory search: case-insensitive ID match**
   - Files: `apps/api/src/modules/employees/infrastructure/prisma-employee.queries.ts` (modify)
   - Do: at `:30`, the ID clause becomes
     `{ nationalIdNumber: { contains: search.replace(/[.\-\s]/g, '').toUpperCase() } }`. IDs are
     stored normalized in uppercase, so a CURP typed in lowercase matches.
   - Observable result: searching `goma850101` finds the colaborador with CURP
     `GOMA850101HQRRRN04` (integration test, step 7).

7. **Existing fixtures and seed to MX/DO/CO**
   - Files: `apps/api/prisma/seed.ts` (modify), `apps/api/src/modules/employees/domain/employee.test.ts` (modify), `apps/api/src/modules/employees/application/commands/register-employee.command.test.ts` (modify), `apps/api/src/modules/organization/application/commands/create-company.command.test.ts` (modify), `apps/api/tests/http.test.ts` (modify), `apps/api/tests/zkteco-adms.test.ts` (modify), `apps/api/tests/integration/organization/prisma-company.int.test.ts` (modify), `apps/api/tests/integration/employees/prisma-employee.int.test.ts` (modify), `apps/web/src/features/organization/components/company-table.test.tsx` (modify), `apps/mobile/src/features/organization/hooks/use-companies.test.tsx` (modify), `packages/api-client/src/client.test.ts` (modify)
   - Do: a mechanical fixture swap that keeps the existing suites compiling and green. It adds
     no new test cases.
     - **Companies:** `country: 'CL'` + `76.086.428-5` becomes `country: 'MX'` + `EKU9003173C9`.
       A second company RUT (`12.345.678-5`, `77.777.777-7`) becomes `AAA010101AAA`. An invalid
       company tax ID (`76.086.428-0`) becomes `EKU900317` (wrong length).
     - **Persons:**
       - `12.345.678-5` becomes `GOMA850101HQRRRN04`.
       - `7.654.321-6` becomes `PEXL900215MDFRPR07`.
       - `12345678-5` (the "other format" variant) becomes `goma850101hqrrrn04` (lowercase).
     - **Displayed formats:** expected `12.345.678-5` or `76.086.428-5` becomes the stored
       uppercase value.
     - **Integration tests:**
       - Rename the `rut` parameter to `nationalId`.
       - Rename test titles that mention "RUT" to "CURP" (employees) or "RFC" (companies).
       - In `prisma-employee.int.test.ts:149-161`, the "por RUT con puntos" case searches
         `'pexl900215'` in lowercase (step 6) and expects `['Pedro Soto']`. The title becomes
         `'busca sin distinguir mayúsculas por nombre y por CURP'`.
     - **Test expectations:** `company-table.test.tsx:43` expects `'MX'`.
     - **Seed:**
       - The companies become `APS Holding S.A. de C.V.` (`MX`, `EKU9003173C9`),
         `APS Servicios RD S.R.L.` (`DO`, `131246796`) and `APS Servicios Colombia S.A.S.`
         (`CO`, `900123456-8`).
       - The employees use the two CURPs above and `@example.com` emails.
       - `holding` is looked up by the new legal name.
   - Observable result: `pnpm check` green, and `pnpm test:integration` green.

8. **Docs and vocabulary**
   - Files: `docs/adr/0009-paises-soportados-e-identificadores.md` (create), `docs/adr/README.md` (modify), `docs/conventions.md` (modify), `docs/harness/conventions/plans.md` (modify), `docs/harness/HARNESS.md` (modify), `.claude/skills/new-module/SKILL.md` (modify), `packages/domain/src/errors.ts` (modify), `plans/hallazgos/platform-localizacion-mexico.md` (modify), `README.md` (modify)
   - Do:
     - **ADR 0009** (Spanish, template `docs/adr/0000-plantilla.md`, Aceptado, 2026-09-28).
       Supported countries are MX, DO and CO; Chile and Peru are dropped. `TaxId` (company) and
       `NationalId` (person) are separate. It includes the validation table and the reasons for
       skipping check digits, with python-stdnum as the reference (algorithm only, LGPL, no
       code copied). Alternatives: one ID with a `kind`, and enforcing every check digit. It
       references ADRs 0001 and 0004 as having Chilean examples that are historical only.
     - **`docs/adr/README.md`:** add row `0009`.
     - **`docs/conventions.md:101`:** the example becomes
       `'rechaza duplicados aunque la CURP venga en minúsculas'`.
     - **`docs/harness/conventions/plans.md:133`:** replace `AFP, Isapre` with
       `IMSS, INFONAVIT, PTU`.
     - **`docs/harness/HARNESS.md:94`:** replace `(RUTs, salaries)` with `(CURP, RFC, salaries)`.
       Only those words change.
     - **`.claude/skills/new-module/SKILL.md:14-15`:** the example becomes
       "(p. ej. asistencia en México se rige por la Ley Federal del Trabajo)".
     - **`packages/domain/src/errors.ts:17`:** in the comment, `RUT inválido` becomes
       `CURP inválida`.
     - **Finding:** set `status: planned` and `plan: platform-localizacion/001`.
   - Observable result: `pnpm plans:lint`, `pnpm harness:check` and `pnpm check` are green.

9. **Test-phase additions (added 2026-09-28, deviation 7, approved by the user)**
   - Files: `packages/contracts/package.json` (modify), `packages/contracts/vitest.config.ts` (create), `packages/contracts/src/common.test.ts` (create), `packages/contracts/src/organization/company.contract.test.ts` (create), `packages/contracts/src/employees/employee.contract.test.ts` (create), `packages/domain/src/country.test.ts` (create), `packages/domain/src/tax-id/tax-id.test.ts` (create), `pnpm-lock.yaml` (modify)
   - Do: the contract layer required by "Test layers required" had no runner. The tester added one
     that mirrors `packages/domain`: a `test` script, `vitest` from the `catalog:`, and a
     `vitest.config.ts`. `pnpm install` regenerated the lockfile, adding 3 lines that link
     `vitest` to `packages/contracts`, with no new version. The user accepted the scope extension.
   - Observable result: `pnpm --filter @rrhh/contracts test` shows 15 passed, and
     `pnpm plans:scope` is green.

## Acceptance criteria

- [ ] `POST /api/v1/companies` with `{ legalName, taxId: 'EKU9003173C9', country: 'MX' }` → 201.
      `GET /api/v1/companies` shows `taxId: 'EKU9003173C9', country: 'MX'`.
- [ ] `POST /api/v1/companies` with `country: 'CO', taxId: '900.123.456-8'` → 201, and the listing
      shows `900.123.456-8`. With `900123456-9` → 400 `VALIDATION_ERROR` at `body.taxId`.
- [ ] `POST /api/v1/companies` with `country: 'DO', taxId: '131246796'` → 201, and the listing shows
      `1-31-24679-6`.
- [ ] `POST /api/v1/companies` with `country: 'CL'` (or `'PE'`) → 400. The country is not accepted.
- [ ] `POST /api/v1/companies/:id/employees` with `nationalId: { country: 'MX', number:
'goma850101hqrrrn04' }` → 201. The directory shows `nationalId: 'GOMA850101HQRRRN04'`.
      A second registration with `GOMA850101HQRRRN04` in the same company → 409
      `EMPLOYEE_ALREADY_EXISTS`.
- [ ] Registering with CURP `GOMA850101HQRRRN05` (wrong DV), or with a CURP whose date is
      `850230`, → 400 at `body.nationalId.number`.
- [ ] `GET …/employees?search=goma850101` finds the colaborador (lowercase search).
- [ ] `pnpm db:seed` on a clean dev DB creates 3 companies (MX, DO, CO) and 2 colaboradores.
- [ ] `pnpm check` and `pnpm test:integration` pass.

## Test layers required

| Layer       | Applies | Focus                                                                                                                                  |
| ----------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| domain      | yes     | every validator: accept, normalize and format each fixture; reject wrong format, date, state code, DV; `TaxId` and `NationalId` parity |
| application | yes     | `CreateCompany` with MX/DO/CO tax IDs; `RegisterEmployee` with a CURP (existing suites, updated)                                       |
| contract    | yes     | `CountrySchema` rejects `CL`/`PE`; `CreateCompanySchema` uses `TaxId`; employee refine uses `NationalId`                               |
| http        | yes     | the acceptance-criteria requests (status, error location)                                                                              |
| integration | yes     | company RFC round trip and uniqueness; lowercase CURP search (step 6)                                                                  |
| e2e         | no      | (no e2e infrastructure yet)                                                                                                            |

## Deviations

Implemented 2026-09-28, inline in the main session, on branch `feat/platform-localizacion`.

1. **Approval (process).** The user approved in chat ("implementalo aqui", 2026-09-28). The plan
   went from `draft` to `implementing` directly.
2. **Third company RFC fixture (cosmetic).** `prisma-company.int.test.ts` needed a third distinct
   company ID. The old `7.654.321-6` became the synthetic `BBB020202BB2`, which is valid format
   and date. The plan mapped that value only for persons.
3. **Formatting after `sed` (cosmetic).** Mechanical fixture swaps done with `sed` skipped the
   Prettier hook. `prettier --write` was run on the 4 affected files.
4. **Throwaway check script.** To confirm the observable results of steps 2–3, a temporary
   `apps/api/scratch-ids.ts` was run with `tsx`. `guard-bash` blocked deleting it (untracked,
   provenance not verifiable), so it was moved to the session scratchpad, outside the repo.
   Every value matched the plan. Examples:
   - `goma850101hqrrrn04` gives `GOMA850101HQRRRN04`, and a wrong DV, date `850230` or state
     `XX` gives ERR.
   - NIT `900.123.456-8` gives `9001234568` and displays as `900.123.456-8`; `900123456-9` gives ERR.
   - RNC `131246796` displays as `1-31-24679-6`.
   - RFC `EKU9003173C9` is ok, and a month 13 gives ERR.
5. **Dev DB was empty.** `pnpm db:up` created fresh volumes (`rrhh_postgres-data Created`), so
   there were no `CL`/`PE` rows. The cleanup command from decision 3 is not needed.
6. **Name vs CURP sex in fixtures (cosmetic, not changed).** Following the plan's mapping, "Ana"
   has a male CURP (`GOMA…H…`) and "Pedro" a female one (`PEXL…M…`). Validation does not relate
   names to sex, and the plan fixed these values.

Runs on 2026-09-28:

- `pnpm check` is green: api 95, domain 22, web 2, mobile 5 and api-client 3 tests;
  `✔ no dependency violations found (105 modules, 297 dependencies cruised)`; plans:lint and
  harness:check pass.
- `pnpm test:integration`: `Test Files 2 passed (2)`, `Tests 16 passed (16)`.
- `pnpm plans:scope`: 36 declared, 38 changed, 0 out of scope.

**Testing phase (tester role), 2026-09-28.**

7. **New test files beyond the Steps' `Files:` lines (test-only).** The "Test layers required"
   table demands a domain matrix (every validator: accept/reject/format, `TaxId` and `NationalId`
   parity) and a contract layer (`CountrySchema` rejects `CL`/`PE`; `CreateCompanySchema` and
   `RegisterEmployeeSchema` refines), but the Steps' `Files:` lines (written for the implementer)
   never allocate paths for these. To fulfil the plan's own floor, this phase added:
   `packages/domain/src/country.test.ts` (new), `packages/domain/src/tax-id/tax-id.test.ts`
   (new), and, since `packages/contracts` had **no test runner at all** (no `test` script, no
   `vitest.config.ts`, no `vitest` devDependency), the minimal harness to run contract tests
   (`packages/contracts/package.json` — added `test` script and `vitest` devDependency,
   `packages/contracts/vitest.config.ts`, mirroring `packages/domain`'s exact setup) plus
   `packages/contracts/src/common.test.ts`, `.../organization/company.contract.test.ts` and
   `.../employees/employee.contract.test.ts`. `pnpm install` regenerated `pnpm-lock.yaml`
   accordingly (adds nothing new to the store; `vitest` was already used elsewhere in the repo).
   `pnpm plans:scope` flags all of these as out of scope, because they are absent from `Files:`
   — expected, since those lines are implementer-scoped. No product code was touched. Also
   expanded `packages/domain/src/national-id/national-id.test.ts` and `apps/api/tests/http.test.ts`
   (both already declared in Steps 2 and 7) with the missing reject/parity/acceptance-criteria
   cases; no new files there.

Runs on 2026-09-28 (tester phase):

- `pnpm check`: green. api 102 tests (was 95, +7 in `tests/http.test.ts`), domain 49 tests (was
  22: +3 `country.test.ts`, +12 `national-id.test.ts` net, +12 `tax-id.test.ts`), contracts 15
  tests (new), web 2, mobile 5, api-client 3. `arch:check`: `✔ no dependency violations found
(105 modules, 297 dependencies cruised)`. `plans:lint` and `harness:check` pass.
- `pnpm test:integration`: `Test Files 2 passed (2)`, `Tests 16 passed (16)` (unchanged — no new
  integration cases were needed; the existing suites already cover the RFC round trip, the
  uniqueness constraint and the lowercase CURP search per the Test layers table).
- `pnpm plans:scope`: 36 declared, 46 changed, 8 out of scope — all test-only, listed in
  Deviation 7 above (`packages/contracts/package.json`, `packages/contracts/vitest.config.ts`,
  `packages/contracts/src/common.test.ts`, `.../organization/company.contract.test.ts`,
  `.../employees/employee.contract.test.ts`, `packages/domain/src/country.test.ts`,
  `packages/domain/src/tax-id/tax-id.test.ts`, `pnpm-lock.yaml`).
- `pnpm db:seed` was **not** run: it writes through the real container against a live
  Postgres, which is outside this phase's mandate (never touch a non-local/dev database as an
  automated side effect of writing tests) and outside the two-run execution budget. The seed's
  3-companies/2-employees shape was confirmed by reading `apps/api/prisma/seed.ts:17-58` against
  the Context fixture table, not by execution — see the "seed crea 3 empresas y 2 colaboradores"
  row below, marked NOT CONFIRMED.

**Repair after review (2026-09-28).** The review (`## Review findings`) found M1 (stale docs)
and M2 (weak CURP date/state fixtures). On the user's decision the main session moved the plan
review → implementing and fixed M1. M2 is test-only and goes to the tester in the next testing
round.

8. **Scope extension, M1 (approved by the user).** `README.md` is added to step 8, and `:13` now
   lists `CountryCode, TaxId/NationalId`. `docs/conventions.md`, already in step 8, is fixed in
   two places. The OCP example now says a new country means registering two validators, and the
   shared-validation line names `TaxId.isValid` and `NationalId.isValid`. The docs are the only
   change.

## Test coverage

| Behavior (from plan / code)                                                                                                                                           | Source (`file:line`)                                                                                         | Layer       | Test                                                                                                                                                                                                                                   | State                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPPORTED_COUNTRIES` is exactly `MX, DO, CO`                                                                                                                         | `packages/domain/src/country.ts:6`                                                                           | domain      | `country.test.ts › SUPPORTED_COUNTRIES son exactamente MX, DO y CO`                                                                                                                                                                    | CONFIRMED                                                                                                                                               |
| `normalizeIdentifier` strips `. - ` /whitespace, uppercases, keeps `Ñ`/`&`                                                                                            | `packages/domain/src/country.ts:24-26`                                                                       | domain      | `country.test.ts › normalizeIdentifier › …`                                                                                                                                                                                            | CONFIRMED                                                                                                                                               |
| MX CURP: accepts and normalizes a valid CURP                                                                                                                          | `national-id/validators.ts:44-52`                                                                            | domain      | `national-id.test.ts › México: acepta y normaliza…`                                                                                                                                                                                    | CONFIRMED                                                                                                                                               |
| MX CURP: `format()` returns the CURP as stored                                                                                                                        | `national-id/validators.ts:52`                                                                               | domain      | `national-id.test.ts › México: format() muestra la CURP tal cual…`                                                                                                                                                                     | CONFIRMED                                                                                                                                               |
| MX CURP: accepts a female fixture born 1990 in DF                                                                                                                     | `national-id/validators.ts:44-52`                                                                            | domain      | `national-id.test.ts › México: acepta una CURP de mujer…`                                                                                                                                                                              | CONFIRMED                                                                                                                                               |
| MX CURP: accepts a 2001 birth (century letter branch)                                                                                                                 | `national-id/validators.ts:56-63` (`isValidCurpDate`)                                                        | domain      | `national-id.test.ts › México: acepta una CURP nacida en 2001…`                                                                                                                                                                        | CONFIRMED                                                                                                                                               |
| MX CURP: rejects a wrong check digit                                                                                                                                  | `national-id/validators.ts:65-68` (`curpCheckDigit`)                                                         | domain      | `national-id.test.ts › México: rechaza una CURP con dígito verificador incorrecto`                                                                                                                                                     | CONFIRMED                                                                                                                                               |
| MX CURP: rejects wrong format (length)                                                                                                                                | `national-id/validators.ts:6` (`CURP_FORMAT`)                                                                | domain      | `national-id.test.ts › México: rechaza formato inválido…`                                                                                                                                                                              | CONFIRMED                                                                                                                                               |
| MX CURP: rejects a calendar date that doesn't exist (30 Feb)                                                                                                          | `national-id/validators.ts:56-63`                                                                            | domain      | `national-id.test.ts › México: rechaza una fecha de nacimiento que no existe…`                                                                                                                                                         | CONFIRMED                                                                                                                                               |
| MX CURP: rejects an unknown state code                                                                                                                                | `national-id/validators.ts:9-42` (`CURP_STATES`)                                                             | domain      | `national-id.test.ts › México: rechaza una clave de entidad federativa inexistente`                                                                                                                                                    | CONFIRMED                                                                                                                                               |
| MX CURP: `NationalId.isValid` matches `create`                                                                                                                        | `national-id/national-id.ts:24-27`                                                                           | domain      | `national-id.test.ts › México: NationalId.isValid coincide con…`                                                                                                                                                                       | CONFIRMED                                                                                                                                               |
| DO cédula: accepts and formats 11 digits (`XXX-XXXXXXX-X`)                                                                                                            | `national-id/validators.ts:75-81`                                                                            | domain      | `national-id.test.ts › República Dominicana: acepta y formatea…`                                                                                                                                                                       | CONFIRMED                                                                                                                                               |
| DO cédula: rejects fewer/more than 11 digits                                                                                                                          | `national-id/validators.ts:78`                                                                               | domain      | `national-id.test.ts › República Dominicana: rechaza una cédula con menos/más de 11 dígitos`                                                                                                                                           | CONFIRMED                                                                                                                                               |
| CO cédula: accepts and formats with thousands dots                                                                                                                    | `national-id/validators.ts:84-87`                                                                            | domain      | `national-id.test.ts › Colombia: acepta y formatea…`                                                                                                                                                                                   | CONFIRMED                                                                                                                                               |
| CO cédula: accepts a short (3-digit) historical id                                                                                                                    | `national-id/validators.ts:86`                                                                               | domain      | `national-id.test.ts › Colombia: acepta una cédula corta…`                                                                                                                                                                             | CONFIRMED                                                                                                                                               |
| CO cédula: rejects more than 10 digits / non-digits                                                                                                                   | `national-id/validators.ts:86`                                                                               | domain      | `national-id.test.ts › Colombia: rechaza una cédula con más de 10 dígitos / caracteres no numéricos`                                                                                                                                   | CONFIRMED                                                                                                                                               |
| MX RFC: accepts and normalizes (SAT test RFC + a second fixture)                                                                                                      | `tax-id/validators.ts:13-19`                                                                                 | domain      | `tax-id.test.ts › México: acepta y normaliza…` / `…acepta otro RFC válido…`                                                                                                                                                            | CONFIRMED                                                                                                                                               |
| MX RFC: rejects wrong length                                                                                                                                          | `tax-id/validators.ts:6` (`RFC_MORAL_FORMAT`)                                                                | domain      | `tax-id.test.ts › México: rechaza un RFC de longitud incorrecta`                                                                                                                                                                       | CONFIRMED                                                                                                                                               |
| MX RFC: rejects a nonexistent incorporation month                                                                                                                     | `tax-id/validators.ts:22-30` (`isValidYymmdd`)                                                               | domain      | `tax-id.test.ts › México: rechaza un RFC con un mes de constitución inexistente`                                                                                                                                                       | CONFIRMED                                                                                                                                               |
| MX RFC: `TaxId.isValid` matches `create` (parity with `NationalId.isValid`)                                                                                           | `tax-id/tax-id.ts:24-27`                                                                                     | domain      | `tax-id.test.ts › México: TaxId.isValid coincide con…`                                                                                                                                                                                 | CONFIRMED                                                                                                                                               |
| DO RNC: accepts and formats `X-XX-XXXXX-X`                                                                                                                            | `tax-id/validators.ts:36-42`                                                                                 | domain      | `tax-id.test.ts › República Dominicana: acepta y formatea…`                                                                                                                                                                            | CONFIRMED                                                                                                                                               |
| DO RNC: rejects fewer/more than 9 digits                                                                                                                              | `tax-id/validators.ts:39`                                                                                    | domain      | `tax-id.test.ts › República Dominicana: rechaza un RNC con menos/más de 9 dígitos`                                                                                                                                                     | CONFIRMED                                                                                                                                               |
| CO NIT: accepts a valid check digit and formats `XXX.XXX.XXX-D`                                                                                                       | `tax-id/validators.ts:47-54`, `nitCheckDigit:58-64`                                                          | domain      | `tax-id.test.ts › Colombia: acepta un NIT con dígito verificador correcto…` / `…acepta otro NIT válido…`                                                                                                                               | CONFIRMED                                                                                                                                               |
| CO NIT: rejects a wrong check digit                                                                                                                                   | `tax-id/validators.ts:50-52`                                                                                 | domain      | `tax-id.test.ts › Colombia: rechaza un NIT con dígito verificador incorrecto`                                                                                                                                                          | CONFIRMED                                                                                                                                               |
| CO NIT: `TaxId.isValid` matches `create`                                                                                                                              | `tax-id/tax-id.ts:24-27`                                                                                     | domain      | `tax-id.test.ts › Colombia: TaxId.isValid coincide con…`                                                                                                                                                                               | CONFIRMED                                                                                                                                               |
| `CreateCompany` creates + publishes `COMPANY_CREATED`; rejects invalid tax id; rejects duplicate (case-insensitive); propagates save conflict; concurrent race        | `create-company.command.ts` (existing suite, MX fixtures only, already updated in the implementing phase)    | application | `create-company.command.test.ts` (existing, unmodified this phase)                                                                                                                                                                     | CONFIRMED                                                                                                                                               |
| `RegisterEmployee` hires + publishes `EMPLOYEE_HIRED`; rejects unknown/inactive employer, invalid email; rejects duplicate; propagates save conflict; concurrent race | `register-employee.command.ts` (existing suite, MX fixtures only, already updated in the implementing phase) | application | `register-employee.command.test.ts` (existing, unmodified this phase)                                                                                                                                                                  | CONFIRMED                                                                                                                                               |
| `CountrySchema` accepts `MX/DO/CO`, rejects `CL/PE` and any other code                                                                                                | `packages/contracts/src/common.ts:36`                                                                        | contract    | `common.test.ts › CountrySchema › …`                                                                                                                                                                                                   | CONFIRMED                                                                                                                                               |
| `CreateCompanySchema` accepts a valid tax id per country; rejects an invalid one at `path: ['taxId']`; rejects an unsupported country                                 | `company.contract.ts:19-29`                                                                                  | contract    | `company.contract.test.ts › CreateCompanySchema › …`                                                                                                                                                                                   | CONFIRMED                                                                                                                                               |
| `RegisterEmployeeSchema` accepts a valid CURP; rejects an invalid one at `path: ['nationalId','number']`; rejects an unsupported country                              | `employee.contract.ts:22-32`                                                                                 | contract    | `employee.contract.test.ts › RegisterEmployeeSchema › …`                                                                                                                                                                               | CONFIRMED                                                                                                                                               |
| `POST /companies` MX → 201, listing shows `EKU9003173C9`                                                                                                              | `apps/api/tests/http.test.ts` (existing)                                                                     | http        | `http.test.ts › crea y lista empresas`                                                                                                                                                                                                 | CONFIRMED                                                                                                                                               |
| `POST /companies` CO `900.123.456-8` → 201, listing shows `900.123.456-8`; `900123456-9` → 400 at `body.taxId`                                                        | `company.contract.ts:25-29`, `tax-id/validators.ts:47-54`                                                    | http        | `http.test.ts › crea una empresa colombiana…` / `…400 si el NIT colombiano…`                                                                                                                                                           | CONFIRMED                                                                                                                                               |
| `POST /companies` DO `131246796` → 201, listing shows `1-31-24679-6`                                                                                                  | `tax-id/validators.ts:36-42`                                                                                 | http        | `http.test.ts › crea una empresa dominicana…`                                                                                                                                                                                          | CONFIRMED                                                                                                                                               |
| `POST /companies` with `CL`/`PE` → 400 (country no longer accepted)                                                                                                   | `common.ts:36` (`CountrySchema`)                                                                             | http        | `http.test.ts › 400 si el país ya no está soportado…`                                                                                                                                                                                  | CONFIRMED                                                                                                                                               |
| `POST …/employees` with a CURP → 201, directory shows the formatted CURP                                                                                              | `apps/api/tests/http.test.ts` (existing)                                                                     | http        | `http.test.ts › registra un colaborador…`                                                                                                                                                                                              | CONFIRMED                                                                                                                                               |
| Second registration with the same CURP in the same company → 409 `EMPLOYEE_ALREADY_EXISTS`                                                                            | `register-employee.command.ts:49-51`                                                                         | http        | `http.test.ts › 409 al registrar la misma CURP dos veces…`                                                                                                                                                                             | CONFIRMED                                                                                                                                               |
| Registering with a wrong-DV CURP → 400 at `body.nationalId.number`                                                                                                    | `employee.contract.ts:22-32`                                                                                 | http        | `http.test.ts › 400 al registrar con una CURP con dígito verificador incorrecto…`                                                                                                                                                      | CONFIRMED                                                                                                                                               |
| Registering with a CURP whose date is `850230` → 400 at `body.nationalId.number`                                                                                      | `national-id/validators.ts:56-63`                                                                            | http        | `http.test.ts › 400 al registrar con una CURP cuya fecha de nacimiento no existe…`                                                                                                                                                     | CONFIRMED                                                                                                                                               |
| Company RFC round trip, normalization on rehydrate, `existsByTaxId`, unique-index race → domain conflict                                                              | `prisma-company.repository.ts`, `prisma-company.queries.ts` (existing suite, MX fixtures)                    | integration | `prisma-company.int.test.ts` (existing, unmodified this phase)                                                                                                                                                                         | CONFIRMED                                                                                                                                               |
| Employee CURP round trip, `existsInCompany` scoped by company, unique-index race, lowercase CURP search (`goma`/`pexl900215`)                                         | `prisma-employee.repository.ts`, `prisma-employee.queries.ts:30` (existing suite)                            | integration | `prisma-employee.int.test.ts` (existing, unmodified this phase — includes "busca sin distinguir mayúsculas por nombre y por CURP")                                                                                                     | CONFIRMED                                                                                                                                               |
| `GET …/employees?search=goma850101` (lowercase, via the real HTTP+Prisma path)                                                                                        | `prisma-employee.queries.ts:30`                                                                              | integration | covered by the row above (`prisma-employee.int.test.ts`); the HTTP-layer in-memory `employeeQueries` stub in `apps/api/tests/test-app.ts:27-45` does not implement `search` at all, so this cannot be exercised through `http.test.ts` | CONFIRMED (integration only)                                                                                                                            |
| `pnpm db:seed` creates 3 companies (MX/DO/CO) and 2 employees on a clean dev DB                                                                                       | `apps/api/prisma/seed.ts:17-58`                                                                              | —           | not executed: writes through the real container against a live Postgres, outside this phase's mandate and budget; the fixture shape was checked by reading the file against the Context table, not by running it                       | NOT CONFIRMED: running `pnpm db:seed` requires a live dev DB and is outside the tester's execution budget and destructive-action boundaries; recon-only |
| Web/mobile fixtures compile and pass with MX/DO/CO data                                                                                                               | `company-table.test.tsx`, `use-companies.test.tsx` (existing suites, updated in the implementing phase)      | —           | unchanged this phase (`pnpm check`: web 2, mobile 5 — green)                                                                                                                                                                           | CONFIRMED                                                                                                                                               |

## Review findings

Reviewed 2026-09-28 (reviewer subagent), diff `main...HEAD` (9188161, 00260b2), working tree clean.

**Checklist: 12/13 — FAIL** (item 13, stale docs).

- [x] `pnpm plans:scope`: 44 declared, 46 changed, all in scope.
- [x] `pnpm check` green (api 102, domain 49, contracts 15, web 2, mobile 5, api-client 3; arch
      `no dependency violations found (105 modules, 297 dependencies cruised)`; plans:lint,
      harness:check, hook/bootstrap/quality tests pass).
- [x] `pnpm test:integration`: 2 files, 16 tests passed.
- [x] Business rules in `domain/` (validators in `packages/domain`); mappers/routers only swap types.
- [x] CQRS-lite unchanged; `existsByTaxId` is a domain port method, not screen-specific.
- [x] Types from `@rrhh/contracts`; `CountrySchema = z.enum(SUPPORTED_COUNTRIES)` without a cast.
- [x] Expected errors are `Result` + `InvalidValueError`; the contract refines give 400 at the field.
- [x] Money/dates/Clock: not affected (`Date.UTC` is only used for pure calendar validation).
- [x] No schema change, no migration (fits `VarChar(20)`/`Char(2)`).
- [x] DI: no new registrations; `tests/container.test.ts` green.
- [x] No secrets or real personal data (synthetic IDs, SAT's public test RFC).
- [x] `## Deviations` honest; spot-check: Deviation 2 `BBB020202BB2` is at
      `apps/api/tests/integration/organization/prisma-company.int.test.ts:77`.
- [ ] Existing docs updated: **fails**, see M1.

### High

None.

### Medium

- **M1 — Stale docs describing the changed behavior (needs doc changes).**
  - `docs/conventions.md:57`: "`CreateCompanySchema` usa `NationalId.isValid`". That is now false:
    it uses `TaxId.isValid` (`packages/contracts/src/organization/company.contract.ts:26`).
  - `docs/conventions.md:19-21`: the OCP example says "un país nuevo = un validador nuevo en el
    mapa; `NationalId` no se toca". Since this plan, a new country needs **two** validators
    (`NATIONAL_ID_VALIDATORS` and `TAX_ID_VALIDATORS`, and `SUPPORTED_COUNTRIES` in
    `country.ts`), as ADR 0009 "Consecuencias" says.
  - `README.md:13`: "Shared kernel (Result, NationalId/RUT, …)". RUT no longer exists.
    `README.md` is **not** in any `Files:` line: the main session must add it to step 8 before the
    implementer touches it.
  - Scenario: someone adding a country follows `docs/conventions.md:19-21` and only adds a person
    validator. That no longer compiles, and the doc points them the wrong way. A reader of
    `conventions.md:57` looks for a `NationalId` refine in the company contract that isn't there.
- **M2 — The CURP date and state rules are not isolated by their reject tests (test-only; tester).**
  Every one of these fixtures also has a **wrong check digit**, so it would still be rejected if
  `isValidCurpDate` or the `CURP_STATES` check were deleted. Check digits were computed with the
  plan's algorithm (scratch script outside the repo):
  - `packages/domain/src/national-id/national-id.test.ts:36`: `GOMA850230HQRRRN01` has DV 1, but
    the correct DV is **2**. The fixture that isolates the date rule is `GOMA850230HQRRRN02`.
  - `packages/domain/src/national-id/national-id.test.ts:40`: `GOMA850101HXXRRN04` has DV 4, but
    the correct DV is **9**. The fixture that isolates the state rule is `GOMA850101HXXRRN09`.
  - `apps/api/tests/http.test.ts:164` and
    `packages/contracts/src/employees/employee.contract.test.ts:33` use the same
    `GOMA850230HQRRRN01`.
  - Scenario: a refactor drops the date check. All suites stay green, so a CURP with a birth
    date of 30 February (with a DV computed to match) is accepted. The acceptance criterion
    "a CURP whose date is `850230` → 400" and the Test coverage rows marked CONFIRMED for the date
    and state rules (`national-id/validators.ts:9-42` and `:56-63`) are not actually proven.
    Deviation 4's "date `850230` or state `XX` gives ERR" has the same gap.

### Low (informational, no change required by this plan)

- **L1 — A leftover `CL`/`PE` row turns the listing into a 500 instead of the mapper's fallback.**
  `apps/api/src/modules/organization/infrastructure/company.mapper.ts:39` (and `:14`,
  `employees/infrastructure/prisma-employee.queries.ts:61-62`, `employee.mapper.ts:9-10`):
  `TAX_ID_VALIDATORS['CL']` is `undefined`, so `validator.normalize` throws a `TypeError` before the
  `taxId.ok ? … : row.taxId` fallback runs. Decision 3 accepts this: dev data is dropped by hand,
  and Deviation 5 says the dev DB was empty. It is recorded only so that verify knows why a stale
  local DB would return 500 on `GET /companies`.
- **L2 (uncertain) — CURP sex character.** `CURP_FORMAT` only accepts `[HM]`, as the plan fixed. I
  could not confirm whether RENAPO or current python-stdnum also accept `X` (non-binary). If they
  do, such a CURP would get a 400. This is outside this plan's validation table, and I did not
  check it against the source.

Status stays `review`. M1 goes back to the implementer (after the main session adds `README.md` to
step 8), and M2 goes to the tester.

## Verification
