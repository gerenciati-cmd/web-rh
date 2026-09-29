# platform-localizacion — Localize the platform to Mexico, Dominican Republic and Colombia

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status platform-localizacion`. -->

## Goal

The holding operates in Mexico (Cancún and several states), the Dominican Republic (Punta Cana)
and Colombia (Bogotá). The repo was modelled on Chile, most likely by imitating Buk, and also
supported Peru. This series makes the shared kernel, contracts, fixtures and docs speak the three
real countries. Company tax IDs and personal IDs become separate concepts, so later business
initiatives (marcaciones, vacaciones, nómina) start from the right country model. Finding:
`plans/hallazgos/platform-localizacion-mexico.md`.

## Plans

| Plan                                   | Title                              | Depends on | Purpose                                                                                |
| -------------------------------------- | ---------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| [001](001-paises-e-identificadores.md) | Countries MX/DO/CO and identifiers | —          | `CountryCode` MX/DO/CO; `TaxId` (company) vs `NationalId` (person); fixtures and docs. |

## Dependency notes

None. Per-site time zones are expected as a later plan in this series, before
`attendance-marcaciones`.

## Decisions with the user

1. (2026-09-28) Supported countries are **Mexico, the Dominican Republic and Colombia** only.
   Chile and Peru are removed ("chile no, nomas esos paises").
2. (2026-09-28) In Mexico, a colaborador is registered with their **CURP**. RFC and NSS come later,
   with payroll.
3. (2026-09-28) Existing dev rows with country `CL`/`PE` are discarded. The user deletes them with
   a command handed over in chat. No code path, migration or use case handles them.
4. (2026-09-28) Buk (the rented SaaS) is the functional reference. It is **not scraped**: the team
   documents flows as normal users and uses official exports for their own data.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Keep one `NationalId` for companies and persons**: it only worked because the Chilean RUT
  covers both. In MX, DO and CO the company ID (RFC moral, RNC, NIT) and the personal ID (CURP,
  cédula) are different documents with different rules.
- **Enforce every published check digit**: python-stdnum reports that about 1.5 % of real RFCs
  have invalid check digits, and it lists about 1,500 real Dominican cédulas that fail Luhn and
  23 RNCs that fail their check. Enforcing them would reject real people and companies.
