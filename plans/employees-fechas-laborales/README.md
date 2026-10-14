# employees-fechas-laborales — Employment dates for other modules

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status employees-fechas-laborales`. -->

## Goal

Other modules can learn a colaborador's hire date and termination date through the public
`EmployeesApi`, so attendance builds jornadas only between them (attendance-asistencia-diaria,
plan 002) and future modules (leave, payroll) reuse the same contract.

## Plans

| Plan                               | Title                         | Depends on | Purpose                                                              |
| ---------------------------------- | ----------------------------- | ---------- | -------------------------------------------------------------------- |
| [001](001-fechas-en-la-fachada.md) | Dates in the employees facade | —          | `EmployeeSummary` gains `hireDate` and `terminationDate` (additive). |

## Dependency notes

None. Consumer: `attendance-asistencia-diaria/002`.

## Decisions with the user

1. (2026-10-14) The daily jornada of attendance is built only from the hire date up to the
   termination date (attendance-asistencia-diaria README, decision 18); the dates come from
   employees through its facade, as every cross-module read does (ADR 0010).

## Delivered

## Considered and discarded

- **Adding the facade change inside the attendance plan**: an initiative belongs to one module
  (`docs/harness/conventions/plans.md`, "Structure"); the change is owned by employees.
