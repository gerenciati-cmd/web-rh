# employees-sede — Sede of the colaborador

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status employees-sede`. -->

## Goal

Every colaborador works at exactly one sede (physical site of the holding, see
`organization-sedes`). Record it at hire and allow changing it, and tell the rest of the system
when a colaborador's sede or RFC changes, so the checadores of each sede can be kept in sync
automatically (`attendance-marcaciones`).

## Plans

| Plan                               | Title                   | Depends on             | Purpose                                                                                                    |
| ---------------------------------- | ----------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- |
| [001](001-sede-del-colaborador.md) | Sede of the colaborador | organization-sedes/001 | `siteId` required at hire, `PUT …/site`, events on site and RFC changes, `EmployeesApi` members of a site. |

## Dependency notes

Needs the `Site` catalog and `OrganizationApi.findSite` from `organization-sedes/001`.

## Decisions with the user

Business decisions live in `organization-sedes` README (decisions 1–9); this series applies:

1. (2026-10-02) A colaborador has exactly one razón social and exactly **one** sede
   (`organization-sedes` decision 6).
2. (2026-10-02) Checadores receive the colaboradores of their sede, automatically and manually
   (`organization-sedes` decisions 1–2): employees publishes the events the sync needs.
3. (2026-10-02) The colaborador's sede must be in the **same country** as their razón social
   (an MX company's colaborador cannot have a sede in Punta Cana).

## Delivered

<!-- Filled when the series closes. -->

## Considered and discarded

- **Several sedes per colaborador**: discarded (`organization-sedes` decision 6).
