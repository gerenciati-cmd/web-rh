# employees-desvinculacion — Termination of colaboradores

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status employees-desvinculacion`. -->

## Goal

HR can register the termination (baja) of a colaborador through the API, with its date and its
reason. The colaborador becomes `TERMINATED`, and the reactions that already listen to
`EMPLOYEE_TERMINATED` start firing for real: their platform access is disabled (identity) and
they are removed from their sede's checadores (attendance). The date and the reason are stored
so the future finiquito (LFT) can build on them.

## Plans

| Plan                                               | Title                              | Depends on | Purpose                                                                                                                                                                                       |
| -------------------------------------------------- | ---------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-endpoint-de-desvinculacion.md)           | Termination endpoint               | —          | `POST …/employees/:employeeId/termination` with date and reason; stored on the colaborador; new permission `employees:terminate`.                                                             |
| [002](002-escrituras-dirigidas-del-colaborador.md) | Targeted writes of the colaborador | 001        | Each use case writes only its columns; termination, RFC and sede writes require the row to be ACTIVE; RFC/sede changes on a terminated colaborador → 422 `EMPLOYEE_INACTIVE` (decisions 6–8). |

## Dependency notes

None. The domain method `Employee.terminate` and both consumers of `EMPLOYEE_TERMINATED`
(identity, attendance) already exist in `done` work; plan 001 only adds the entry point and the
stored data.

## Decisions with the user

1. (2026-10-12) Termination is the next initiative after `attendance-marcaciones` (its README,
   "Delivered", lists the missing termination endpoint).
2. (2026-10-12) A termination stores its **date and reason**. The reason comes from a closed
   catalog; no free-text note in this delivery.
3. (2026-10-12) Reason catalog, based on the LFT (rescisión arts. 47/51, terminación art. 53),
   accepted as proposed: `VOLUNTARY_RESIGNATION` (renuncia voluntaria), `DISMISSAL_WITH_CAUSE`
   (despido justificado, art. 47), `DISMISSAL_WITHOUT_CAUSE` (despido injustificado),
   `MUTUAL_AGREEMENT` (mutuo consentimiento), `END_OF_CONTRACT` (término de contrato u obra),
   `DEATH` (fallecimiento), `INCAPACITY` (incapacidad física o mental), `OTHER` (otro).
4. (2026-10-12) **No future-dated terminations**: the date is today or earlier, and the
   termination takes effect when registered (removed from checadores, access closed at once).
   Scheduled terminations would be a separate feature with a job.
5. (2026-10-12) A dedicated permission **`employees:terminate`**, granted to HR (company scope)
   and HOLDING_ADMIN (all permissions), so who edits data and who terminates can be split later.
6. (2026-10-12) The finding `employees-guardado-completo-pisa-la-baja` (review Medium-1 of 001)
   is fixed in this series, plan 002.
7. (2026-10-12) Fixed with **targeted writes** per use case (as attendance did for devices,
   its README decision 11), not with an optimistic version column: no new 409 for HR, and the
   termination write is conditional on the row still being ACTIVE, so a double submit answers
   `EMPLOYEE_ALREADY_TERMINATED` and publishes one event.
8. (2026-10-12) A terminated colaborador's **sede and RFC can no longer be changed**: 422
   `EMPLOYEE_INACTIVE` (the code identity already uses for "terminated, cannot be invited").

## Delivered

Series closed on 2026-10-14; plans 001–002 are `done`, verified against the dev API (the real
checador was not exercised in this series; the `DELETE USERINFO` it receives was already
confirmed on it by attendance plan 007).

- **Termination endpoint** (001): `POST …/employees/:employeeId/termination` with a date (today or
  earlier, not before hire) and an LFT-based reason from a closed catalog; stored on the
  colaborador; new permission `employees:terminate` (HR, HOLDING_ADMIN). The colaborador becomes
  `TERMINATED`, loses platform access and is removed from their sede's checadores.
- **Targeted writes** (002): each use case writes only its columns, so a concurrent RFC or sede
  save no longer undoes a termination; a double submit answers `EMPLOYEE_ALREADY_TERMINATED` and
  publishes one event; RFC and sede of a terminated colaborador → 422 `EMPLOYEE_INACTIVE`.

Not in this series: future-dated terminations (decision 4), the finiquito (it builds on the stored
date and reason), rehiring a terminated colaborador, and web/mobile screens.

## Considered and discarded

- **Optimistic version column on `employees.employees`** for the full-row overwrite: every
  employees endpoint would gain a 409 that HR must retry, and two edits of different columns
  would conflict for no reason. Discarded by decision 7.

- **Reusing `employees:update`** for termination: simpler, but couples editing RFC/sede with
  ending employment. Discarded by decision 5.
- **Future-dated (scheduled) terminations**: need a job that terminates on the day and a
  "pending termination" state. Discarded for this delivery by decision 4.
- **Short reason list** (resignation / dismissal / end of contract / other): would have to be
  migrated when the finiquito needs the LFT distinctions. Discarded by decision 3.
