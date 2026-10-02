# organization-sedes — Sedes (physical work sites) of the holding

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status organization-sedes`. -->

## Goal

Model the **sede**: the physical place where colaboradores work and mark attendance ("Cancún
Centro", "Punta Cana"), distinct from the razón social (company). A sede belongs to the holding,
not to a company, because one site and its checador are shared by colaboradores of several
companies. It is the base for two follow-up series: each colaborador gets one sede
(`employees`), and each checador is tied to a sede and receives that sede's colaboradores
(`attendance`).

## Plans

| Plan                            | Title            | Depends on | Purpose                                                                                                                                |
| ------------------------------- | ---------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-catalogo-de-sedes.md) | Catalog of sedes | —          | `Site` aggregate (name, country, time zone from a closed per-country list, active); create/list endpoints; `OrganizationApi.findSite`. |

## Dependency notes

Planned consumers (not written yet): an `employees` series (sede of the colaborador) and
`attendance-marcaciones/003` (checador per sede, pushing users to the device, clock-offset
detection). Both depend on 001.

## Decisions with the user

1. (2026-10-02) Checadores are assigned to a sede, and each checador receives only the
   colaboradores of its sede.
2. (2026-10-02) Sending colaboradores to the checador is both automatic and manual (attendance
   series).
3. (2026-10-02) On termination the colaborador is removed from the checador, and the record is kept
   in the system (attendance series; needs a termination endpoint that does not exist yet).
4. (2026-10-02) The test device's users "1" (admin) and "2" (created by the user) stay; sync never
   deletes users it did not create.
5. (2026-10-02) The sede belongs to the **holding**: one physical site is shared by colaboradores of
   several razones sociales (e.g. DPS and SA Gate in the same office).
6. (2026-10-02) A colaborador has exactly **one** razón social (already true) and **one** sede.
7. (2026-10-02) A sede has: unique name, country (MX/DO/CO), time zone, active. Address and state
   are left out until payroll needs them.
8. (2026-10-02) The time zone is chosen from a **closed list per country** (not free text), to cut
   the "valid but wrong zone" error (e.g. `America/Mexico_City` for Cancún = 1 h off).
9. (2026-10-02) The attendance series adds **clock-offset detection** (punch UTC vs. reception
   time), threshold proposed at 5 minutes, to catch a wrong zone or a wrong device clock.

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Sede per company**: discarded by decision 5 (shared sites and checadores).
- **Free-text IANA time zone** (as devices have today): discarded by decision 8.
- **Several sedes per colaborador** (rotating staff in several checadores): discarded by decision 6.
