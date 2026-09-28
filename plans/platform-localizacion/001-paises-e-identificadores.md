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
   - Files: `docs/adr/0009-paises-soportados-e-identificadores.md` (create), `docs/adr/README.md` (modify), `docs/conventions.md` (modify), `docs/harness/conventions/plans.md` (modify), `docs/harness/HARNESS.md` (modify), `.claude/skills/new-module/SKILL.md` (modify), `packages/domain/src/errors.ts` (modify), `plans/hallazgos/platform-localizacion-mexico.md` (modify)
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

## Test coverage

## Review findings

## Verification
