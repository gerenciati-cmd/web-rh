---
status: done
module: organization
min_implementer: mid
depends_on: []
---

# 001 — Catalog of sedes

## Context

**What exists today:**

- `organization` has only companies: aggregate `Company` (`apps/api/src/modules/organization/domain/company.ts:27-87`),
  errors (`domain/errors.ts:1-17`), command `CreateCompany`
  (`application/commands/create-company.command.ts:20-52`), read port `CompanyQueries`
  (`application/queries/company.queries.ts:7-11`), `ListCompanies`
  (`application/queries/list-companies.query.ts:22-28`), Prisma adapters
  (`infrastructure/prisma-company.repository.ts:118-149`, `infrastructure/prisma-company.queries.ts:37-75`),
  mapper (`infrastructure/company.mapper.ts:116-153`), in-memory store shared by repository and
  queries (`infrastructure/in-memory/in-memory-company.store.ts:14-71`), router
  (`http/organization.router.ts:86-106`), module (`organization.module.ts:15-38`).
- Public API: `OrganizationApi.findCompany` only (`application/organization.facade.ts:44-67`),
  exported in `apps/api/src/modules/organization/index.ts:1-6`.
- Contract shape: `packages/contracts/src/organization/company.contract.ts:1-64`; catalog
  `packages/contracts/src/index.ts`; the OpenAPI test counts operations
  (`packages/contracts/src/openapi.test.ts:49`, currently 23).
- No colaborador or device has a site: model `Employee` and `AttendanceDevice` in
  `apps/api/prisma/schema.prisma` (schemas list at `schema.prisma:19`).
- Time-zone helper: `isValidTimeZone` (`packages/domain/src/time-zone.ts:4-12`), which accepts any
  IANA zone the runtime knows.
- Permissions `PERMISSIONS` (`packages/domain/src/identity/access.ts:6-21`); HR's list
  (`apps/api/src/modules/identity/domain/role-catalog.ts:16-31`); HOLDING_ADMIN gets every
  permission (`role-catalog.ts:15`).
- Test container wires the in-memory company store (`apps/api/tests/test-app.ts:54`, `:128-129`).
- Countries: `SUPPORTED_COUNTRIES = ['MX', 'DO', 'CO']` (`packages/domain/src/country.ts:6`).
- Candidate zones checked on this machine's Node (`Intl.supportedValuesOf('timeZone')`, offsets
  on 2026-01-15 / 2026-07-15): `America/Mexico_City` −6/−6, `America/Cancun` −5/−5,
  `America/Merida` −6/−6, `America/Monterrey` −6/−6, `America/Matamoros` −6/−5,
  `America/Chihuahua` −6/−6, `America/Ciudad_Juarez` −7/−6, `America/Ojinaga` −6/−5,
  `America/Mazatlan` −7/−7, `America/Bahia_Banderas` −6/−6, `America/Hermosillo` −7/−7,
  `America/Tijuana` −8/−7, `America/Santo_Domingo` −4/−4, `America/Bogota` −5/−5. All exist.

**What we need** (README decisions 5–8): a holding-level catalog of sedes (unique name, country,
time zone from a closed per-country list, active), endpoints to create and list them, and a
lookup in `OrganizationApi` for the `employees` and `attendance` follow-ups.

**Approach.** A new aggregate `Site` in `organization`, copied from `Company` by shape. The closed
zone list lives in the shared kernel (`packages/domain`) so the contract and the aggregate apply
the same rule, as `TaxId` does for companies. Alternative considered: keep free-text zones
validated only by `isValidTimeZone` (as devices do). Rejected by decision 8. Name uniqueness is
case-insensitive: the command checks with `mode: 'insensitive'` and the database keeps a unique
index on the normalized name (`name_key`, the trimmed name in lowercase) as last defense.

## Out of scope

- Assigning a sede to a colaborador (employees series) or to a checador (attendance series).
- Editing, renaming or deactivating a sede through the API (the `active` column exists; the
  endpoint does not). Address, state, seed sedes, web/mobile screens.
- Changing `AttendanceDevice.timeZone` or how devices validate their zone.

## Dependencies

None.

## Steps

1. **Closed list of time zones per country**
   - Files: `packages/domain/src/site-time-zones.ts` (create), `packages/domain/src/index.ts` (modify)
   - Do: `export const SITE_TIME_ZONES: Readonly<Record<CountryCode, readonly string[]>>` with
     MX: `America/Mexico_City`, `America/Cancun`, `America/Merida`, `America/Monterrey`,
     `America/Matamoros`, `America/Chihuahua`, `America/Ciudad_Juarez`, `America/Ojinaga`,
     `America/Mazatlan`, `America/Bahia_Banderas`, `America/Hermosillo`, `America/Tijuana`;
     DO: `America/Santo_Domingo`; CO: `America/Bogota`. Plus
     `isSiteTimeZone(country: CountryCode, timeZone: string): boolean`. Docblock in Spanish:
     closed list on purpose (README decision 8), a zone that is valid but wrong for the place
     shifts every marcación; adding a zone is a deliberate change. Export from `index.ts`.
   - Observable result: `isSiteTimeZone('MX', 'America/Cancun')` is `true`;
     `isSiteTimeZone('MX', 'America/Bogota')` and `isSiteTimeZone('DO', 'America/Cancun')` are
     `false`.

2. **Permissions**
   - Files: `packages/domain/src/identity/access.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.ts` (modify), `apps/api/src/modules/identity/domain/role-catalog.test.ts` (modify), `apps/api/src/modules/identity/application/session-authenticator.test.ts` (modify)
   - Do: add `'organization.sites:read'` and `'organization.sites:manage'` after
     `'organization.companies:create'`. HR gets `'organization.sites:read'` (after
     `'organization.companies:read'`); HOLDING_ADMIN gets both automatically. In the two tests,
     only update the expected HR list and HR grant counts (+1).
   - Observable result: `pnpm --filter @rrhh/api test role-catalog session-authenticator` passes.

3. **Contract**
   - Files: `packages/contracts/src/organization/site.contract.ts` (create), `packages/contracts/src/index.ts` (modify), `packages/contracts/openapi.json` (modify), `packages/contracts/src/openapi.test.ts` (modify)
   - Do (shape of `company.contract.ts:1-64`):
     - `SiteSchema` (`.meta({ id: 'Site' })`): `id: z.uuid()`, `name: z.string()`,
       `country: CountrySchema`, `timeZone: z.string()`, `active: z.boolean()`,
       `createdAt: z.iso.datetime()`. `type SiteDto`.
     - `CreateSiteSchema` (`.meta({ id: 'CreateSiteInput' })`):
       `name: z.string().trim().min(2).max(100)`, `country: CountrySchema`,
       `timeZone: z.string().trim()`, refined with `isSiteTimeZone(country, timeZone)`
       (`path: ['timeZone']`, message `'Zona horaria no permitida para el país de la sede'`).
       `type CreateSiteInput` (`z.input`).
     - `siteRoutes = { listSites, createSite }`: `GET /sites`, summary
       `'Sedes del holding'`, `requires('organization.sites:read')`, `query: PageQuerySchema`,
       `response: pageOf(SiteSchema)`; `POST /sites`, summary `'Crea una sede del holding'`,
       `requires('organization.sites:manage')`, `body: CreateSiteSchema`,
       `response: CreatedSchema`, `successStatus: 201`.
     - `index.ts`: `export *` the file and add `sites: siteRoutes` to `apiRoutes`.
     - Regenerate `pnpm --filter @rrhh/contracts openapi`; `openapi.test.ts:49` count 23 → 25.
   - Observable result: `pnpm --filter @rrhh/contracts test` passes.

4. **Domain**
   - Files: `apps/api/src/modules/organization/domain/site.ts` (create), `apps/api/src/modules/organization/domain/site.repository.ts` (create), `apps/api/src/modules/organization/domain/errors.ts` (modify)
   - Do, `site.ts` (shape of `company.ts:27-87`): `SiteId = Id<'Site'>`; props `name`, `country:
CountryCode`, `timeZone`, `active`, `createdAt`; `SITE_CREATED = 'organization.site.created'`;
     `static create({ id, name, country, timeZone, now })` → `Result<Site, InvalidValueError>`:
     name trimmed 2–100 chars (`'El nombre de la sede debe tener entre 2 y 100 caracteres'`),
     `isSiteTimeZone(country, timeZone)` (`'Zona horaria no permitida para el país de la sede'`);
     starts active; records `SITE_CREATED` `{ siteId, country }`. `static restore`; getters.
   - Do, `site.repository.ts`: `SiteRepository { findById(id); existsByName(name: string):
Promise<boolean>` (case-insensitive, trimmed) `; save(site): Promise<Result<void,
SiteAlreadyExistsError>> }`.
   - Do, `errors.ts`: `SiteAlreadyExistsError extends ConflictError`, code
     `'SITE_ALREADY_EXISTS'`, `'Ya existe una sede con ese nombre'`, details `{ name }`.
   - Observable result: typecheck passes for these files.

5. **Application**
   - Files: `apps/api/src/modules/organization/application/commands/create-site.command.ts` (create), `apps/api/src/modules/organization/application/queries/site.queries.ts` (create), `apps/api/src/modules/organization/application/queries/list-sites.query.ts` (create), `apps/api/src/modules/organization/application/organization.facade.ts` (modify)
   - Do, `CreateSite` (shape of `create-company.command.ts:20-52`): deps `siteRepository,
idGenerator, clock, eventBus`; `existsByName` → `SiteAlreadyExistsError`; `Site.create`;
     `save`; publish; `ok({ id })`.
   - Do, `SiteQueries { list(page: PageQuery): Promise<Page<SiteDto>>; findById(id): Promise<SiteDto | null> }`.
     `ListSites.execute(page)` → `siteQueries.list(page)` (sites are holding-level: no company
     filter).
   - Do, facade: `SiteSummary { id; name; country: CountryCode; timeZone; active }`;
     `OrganizationApi.findSite(siteId): Promise<SiteSummary | null>`, implemented with a new dep
     `siteRepository`. Docblock: consumers are the planned employees and attendance series.
   - Observable result: typecheck passes.

6. **Persistence**
   - Files: `apps/api/prisma/schema.prisma` (modify), `apps/api/prisma/migrations/20261002195817_create_sites/migration.sql` (create), `apps/api/src/modules/organization/infrastructure/site.mapper.ts` (create), `apps/api/src/modules/organization/infrastructure/prisma-site.repository.ts` (create), `apps/api/src/modules/organization/infrastructure/prisma-site.queries.ts` (create), `apps/api/src/modules/organization/infrastructure/in-memory/in-memory-site.store.ts` (create)
   - Do, schema (recipe `db-change`), in the organization section after `Company`:
     `model Site { id String @id @db.Uuid; name String @db.VarChar(100); nameKey String @unique
@map("name_key") @db.VarChar(100); country String @db.Char(2); timeZone String
@map("time_zone") @db.VarChar(64); active Boolean @default(true); createdAt DateTime
@map("created_at") @db.Timestamptz(3); updatedAt DateTime @updatedAt @map("updated_at")
@db.Timestamptz(3); @@map("sites") @@schema("organization") }`, with
     `/// nombre normalizado (trim + minúsculas): unicidad sin distinguir mayúsculas`.
     Generate the migration (if `pnpm db:migrate` cannot run non-interactively, use
     `prisma migrate diff` + `prisma migrate deploy` as in `employees-rfc/001` Deviation 1); no
     `DROP`. Replace the placeholder in this `Files:` line with the real folder; note it in
     Deviations.
   - Do, mapper (shape of `company.mapper.ts:116-153`): `toDomain`, `toPersistence` (writes
     `nameKey = name.trim().toLowerCase()`), `toDto`.
   - Do, `PrismaSiteRepository` (shape of `prisma-company.repository.ts:118-149`):
     `existsByName` counts by `nameKey`; `save` upserts and maps `isUniqueViolation` to
     `SiteAlreadyExistsError`. `PrismaSiteQueries`: `list` ordered by `name asc, id asc`, paginated
     with `count`; `findById`.
   - Do, `in-memory-site.store.ts` (shape of `in-memory-company.store.ts:14-71`):
     `InMemorySiteStore`, `InMemorySiteRepository`, `InMemorySiteQueries`, same semantics.
   - Observable result: migration applied; `\d organization.sites` shows the unique `name_key`.

7. **HTTP, module, public API, test wiring**
   - Files: `apps/api/src/modules/organization/http/organization.router.ts` (modify), `apps/api/src/modules/organization/organization.module.ts` (modify), `apps/api/src/modules/organization/index.ts` (modify), `apps/api/tests/test-app.ts` (modify)
   - Do: `bindRoute` for `listSites` (`deps.listSites.execute(query)`) and `createSite`
     (`unwrap(await deps.createSite.execute(body))`). Register `siteRepository`, `siteQueries`
     (Prisma), `createSite`, `listSites` in cradle and registrations. Export `SiteSummary` type
     from `index.ts`. `test-app.ts`: one `InMemorySiteStore`, register `siteRepository` and
     `siteQueries` with the in-memory classes next to the company ones (`:128-129`).
   - Observable result: `pnpm check` passes; `tests/container.test.ts` resolves the new keys.

8. **Docs**
   - Files: `docs/harness/modules.json` (modify)
   - Do: organization summary "Empresas del holding. Exposes OrganizationApi to other modules." →
     "Empresas y sedes del holding. Exposes OrganizationApi to other modules."
   - Observable result: `pnpm check` passes.

9. **Test files of this plan** (added after review L1; written by the tester)
   - Files: `packages/domain/src/site-time-zones.test.ts` (create), `packages/contracts/src/organization/site.contract.test.ts` (create), `apps/api/src/modules/organization/domain/site.test.ts` (create), `apps/api/src/modules/organization/application/commands/create-site.command.test.ts` (create), `apps/api/src/modules/organization/application/queries/list-sites.query.test.ts` (create), `apps/api/src/modules/organization/application/organization.facade.test.ts` (create), `apps/api/tests/sites.test.ts` (create), `apps/api/tests/integration/organization/prisma-site.int.test.ts` (create)
   - Do: the layers of "Test layers required".
   - Observable result: `pnpm check` and `pnpm test:integration` pass.

## Acceptance criteria

- [x] `POST /api/v1/sites` as HOLDING_ADMIN `{ name: 'Cancún Centro', country: 'MX', timeZone:
'America/Cancun' }` → 201 `{ id }`; `GET /api/v1/sites` lists it with `active: true`.
- [x] Same name with different case (`'cancún centro'`) → 409 `SITE_ALREADY_EXISTS`.
- [x] `country: 'MX', timeZone: 'America/Bogota'` → 400 at `timeZone`; `country: 'DO', timeZone:
'America/Santo_Domingo'` → 201; an invented zone → 400.
- [x] HR → `GET /sites` 200, `POST /sites` 403; anonymous → 401.
- [x] `/api/v1/docs` shows the two routes.

## Test layers required

| Layer       | Applies | Focus                                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------------------------- |
| domain      | yes     | `isSiteTimeZone` per country; `Site.create` name and zone rules                           |
| application | yes     | `CreateSite` happy path + duplicate (case-insensitive); `ListSites`; facade `findSite`    |
| contract    | yes     | `CreateSiteSchema` zone-by-country refine and name bounds; access of the two routes       |
| http        | yes     | acceptance criteria over supertest                                                        |
| integration | yes     | `PrismaSiteRepository` unique `name_key` (case), `PrismaSiteQueries` order and pagination |
| e2e         | no      | (no e2e infrastructure yet)                                                               |

## Deviations

- Cosmetic: the migration placeholder in step 6 `Files:` was replaced with the real folder
  `20261002195817_create_sites` (as the plan asked). `pnpm db:migrate --create-only` worked
  non-interactively, then `pnpm db:deploy` applied it to the dev DB; no `DROP`. Otherwise: None.
- Note: `pnpm plans:scope` reports many out-of-scope paths (119 changed) because the branch
  already carries other plans' commits versus its base; the files touched in this session are
  all within the plan's list.

## Test coverage

Baseline (before tests): `pnpm check` green (api 656 passed / 4 skipped), `pnpm test:integration`
green (153). No GAP and no NOT CONFIRMED found: every behavior was confirmed from code and execution.

| Behavior                                                                | Source                                                 | Layer       | Test                                                             | State     |
| ----------------------------------------------------------------------- | ------------------------------------------------------ | ----------- | ---------------------------------------------------------------- | --------- |
| `isSiteTimeZone` accepts own-country zones, rejects other/invented/case | `packages/domain/src/site-time-zones.ts:25`            | domain      | `site-time-zones.test.ts`                                        | CONFIRMED |
| Every listed zone exists in the runtime                                 | `site-time-zones.ts:7-24`                              | domain      | `site-time-zones.test.ts` (última prueba)                        | CONFIRMED |
| `Site.create` name 2-100 trimmed, zone rule, active, `SITE_CREATED`     | `domain/site.ts:39-62`                                 | domain      | `domain/site.test.ts`                                            | CONFIRMED |
| `Site.restore` emits no events                                          | `site.ts:65`                                           | domain      | `domain/site.test.ts`                                            | CONFIRMED |
| `CreateSite` happy path, case/space-insensitive duplicate, bad zone     | `create-site.command.ts:27-47`                         | application | `create-site.command.test.ts`                                    | CONFIRMED |
| `CreateSite` propagates save conflict w/o event; unexpected IO rejects  | `create-site.command.ts:43-44`                         | application | `create-site.command.test.ts`                                    | CONFIRMED |
| `ListSites` order, pagination, empty, no company filter                 | `list-sites.query.ts`, `in-memory-site.store.ts:50-58` | application | `list-sites.query.test.ts`                                       | CONFIRMED |
| Facade `findSite` summary / null                                        | `organization.facade.ts:58-67`                         | application | `organization.facade.test.ts`                                    | CONFIRMED |
| `CreateSiteSchema` zone refine (path `timeZone`), name bounds, trim     | `site.contract.ts:21-33`                               | contract    | `site.contract.test.ts`                                          | CONFIRMED |
| Route access: read / manage, 201                                        | `site.contract.ts:36-52`                               | contract    | `site.contract.test.ts`                                          | CONFIRMED |
| Acceptance criteria 1-5 (201, 409, 400, DO 201, HR 200/403, 401, docs)  | plan acceptance                                        | http        | `apps/api/tests/sites.test.ts`                                   | CONFIRMED |
| Unique `name_key` by case, concurrent saves                             | `prisma-site.repository.ts:27-34`                      | integration | `tests/integration/organization/prisma-site.int.test.ts`         | CONFIRMED |
| `PrismaSiteQueries` order, pagination, `findById`                       | `prisma-site.queries.ts:20-42`                         | integration | `prisma-site.int.test.ts`                                        | CONFIRMED |
| Permissions role catalog / session grants (+1 HR)                       | updated in step 2 by the implementer                   | domain/app  | existing `role-catalog.test.ts`, `session-authenticator.test.ts` | CONFIRMED |
| e2e                                                                     | no infrastructure                                      | e2e         | n/a (plan: no)                                                   | n/a       |

## Review findings

Reviewed 2026-10-02, diff `2ce01f9..HEAD` (`ce63106` implementation + `4e5e958` tests), working
tree clean.

**Checklist: 12/13 — FAIL (1 item).**

- [ ] `pnpm plans:scope --base 2ce01f9`: exits 1. 37 files changed. The 29 implementation files
      are all declared. The 8 test files the tester wrote are not declared in any `Files:` line
      (L1). Hot files: `schema.prisma` (new `Site` model after `Company`, as step 6 says),
      `test-app.ts` (additions only), `contracts/src/index.ts` (additions only; `sites:` is
      inserted after `organization:`, not at the end, but step 3 declares it) and `modules.json`
      (one line edited, declared in step 8). All are in scope. Note: without `--base`, the tool
      compares against `main` and also lists 90+ paths from other plans' commits on this branch.
- [x] `pnpm check` green: api 682 passed / 4 skipped, contracts 198, domain 98, web 2, mobile 5,
      arch, plans, harness, hooks, quality. No lint warnings.
- [x] `pnpm test:integration` green: 14 files, 160 tests.
- [x] Business rules are in `domain/`: the name bounds and the zone rule are in `Site.create`, and
      the zone list is in the shared kernel (`site-time-zones.ts`). The contract reuses
      `isSiteTimeZone`, the same pattern as `TaxId`. The router, mapper and adapters contain no
      rules.
- [x] CQRS-lite: `CreateSite` goes aggregate → `SiteRepository` → `Result`. `ListSites` →
      `SiteQueries` → `SiteDto`. The repository only has `findById`, `existsByName` (an invariant
      check) and `save`.
- [x] Types come from `@rrhh/contracts`. `openapi.json` was regenerated (the count is now 25).
      The command's local `CreateSiteInput` follows the same pattern as `CreateCompanyInput`.
- [x] Errors: `SITE_ALREADY_EXISTS` (Conflict → 409), `InvalidValueError` for domain validation.
      The unique violation maps to the domain error. Internals don't leak.
- [x] No money. `createdAt` comes from `Clock` and is stored as `Timestamptz`. The id comes from
      `IdGenerator`.
- [x] New migration `20261002195817_create_sites`: CREATE TABLE plus a unique index only. No DROP
      and no FK.
- [x] DI: `siteRepository`, `siteQueries`, `createSite` and `listSites` are each registered once
      in `organization.module.ts`. The facade receives `siteRepository`. `container.test.ts` is
      green.
- [x] No secrets or real personal data. The fixtures are synthetic sede names.
- [x] Deviations are honest. I spot-checked the migration folder: it matches the step 6 `Files:`
      line and contains no `DROP`.
- [x] Docs: `modules.json` was updated. `architecture.md` and `conventions.md` don't describe sedes
      or the organization endpoints in a way that is now wrong.

### Findings

**Critical / High / Medium: none.** I traced the bug hunt end to end for POST and GET `/sites`:
contract (trim, refine on `timeZone`) → `CreateSite` (trimmed name, `existsByName` on
`name_key`) → `Site.create` → upsert → 201. I also checked case-insensitive duplicates, the race
between two requests (the unique index → 409, covered in integration), and authorization (HR
read-only and holding-level, by design; anonymous → 401). `findSite` works for an unknown id
(returns null).

**Low**

- **L1 — the plan doesn't declare its test files** (plan, step list). These files are missing
  from every `Files:` line, so `plans:scope` fails:
  `domain/site.test.ts`, `application/commands/create-site.command.test.ts`,
  `application/queries/list-sites.query.test.ts`, `application/organization.facade.test.ts`
  (under `apps/api/src/modules/organization/`), `apps/api/tests/sites.test.ts`,
  `apps/api/tests/integration/organization/prisma-site.int.test.ts`,
  `packages/contracts/src/organization/site.contract.test.ts`,
  `packages/domain/src/site-time-zones.test.ts`. Fix: the main session adds a step "Test files
  of this plan", as in `attendance-marcaciones/002` step 6. This is a plan edit only; no code
  changes.
- **L2 — `name_key` can be longer than `VARCHAR(100)`** (`site.mapper.ts:28`,
  `schema.prisma:42`). `toLowerCase()` can make a string longer. For example, `'İ'` (U+0130)
  becomes `'i̇'`, which is 2 code points. A 100-character name containing that letter passes the
  contract and the domain, but the insert fails with Postgres 22001. That is an unexpected
  exception, so the client gets a 500 instead of a 400. Not reproduced, because the hook blocks
  inline `node -e`; this is based on documented `String.prototype.toLowerCase` semantics. It is
  very unlikely with real sede names. Possible fixes: widen `name_key`, which needs a new
  migration, or accept it and record the decision.
- **L3 — Unicode normalization (uncertain)** (`site.mapper.ts:28`,
  `prisma-site.repository.ts:22`). The normalized key doesn't apply `normalize('NFC')`.
  `'Cancún'` with a precomposed `ú` and the same name with `u` + a combining accent produce
  different keys, so two sedes that look identical can both be created. Some input methods and
  copy-paste sources produce NFD. Whether this matters is a product decision; the plan only
  defines the key as "trim + lowercase", so as written the code follows the plan.

**Info**

- I1 — The in-memory `list` sorts with `localeCompare` and Prisma sorts with the database
  collation. The two orders can differ for mixed-case names. Only the Prisma order is observable
  in production, and it is covered in integration. No change needed.

Status stays `review`. L1 needs a plan edit by the main session. L2 and L3 need a decision:
accept and record it, or make a small in-scope fix. If the main session declares the test files
and accepts L2 and L3, no code changes are pending and the plan can go to `verify`.

### Resolution (main session, 2026-10-02)

- **L1 — fixed:** step 9 declares the eight test files.
- **L2 — accepted:** the 500 needs a 100-character name built from letters such as `İ` that grow
  when lowercased; sede names are short Spanish place names. Widening the column needs a new
  migration for no observed case. Revisit if a sede name ever fails this way.
- **L3 — fixed:** `siteNameKey` in `domain/site.ts` (trim → NFC → lowercase) is the only key
  function, used by the mapper, the Prisma repository and the in-memory store. Regression tests:
  `site.test.ts` (`siteNameKey` NFC/NFD) and `create-site.command.test.ts` (NFD duplicate → 409).
- **I1:** no change.

## Verification

**PASS** — 2026-10-02, main session, at `113122d`, against the dev API on `localhost:3000`
(running from the branch, with migration `20261002195817_create_sites` applied to the dev DB).

- Suites: `pnpm check` green; `pnpm test:integration` 14 files / 160 tests green;
  `pnpm plans:scope … --base 2ce01f9` all in scope.
- Script over HTTP (synthetic names with a random suffix), 11/11 PASS:
  - HOLDING_ADMIN `POST /sites` MX `America/Cancun` → 201; `GET /sites` lists it with
    `active: true` and its zone.
  - Same name lowercased with extra spaces → 409 `SITE_ALREADY_EXISTS`; same name in NFD
    (review L3) → 409 `SITE_ALREADY_EXISTS`.
  - MX + `America/Bogota` → 400 at `timeZone`; DO + `America/Santo_Domingo` → 201; invented zone
    `America/Atlantida` → 400 at `timeZone`.
  - HR: `GET /sites` 200, `POST /sites` 403; anonymous `GET /sites` 401.
  - `/api/v1/openapi.json` has `/sites` with `get` and `post` (the source of `/api/v1/docs`).
- Data left in the dev DB: two sedes named `Verificación … <suffix>` (MX and DO). There is no
  delete endpoint; they are harmless and recognizable.
