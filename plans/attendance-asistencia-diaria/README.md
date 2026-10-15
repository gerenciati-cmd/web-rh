# attendance-asistencia-diaria — Shifts and daily attendance

<!-- Initiative index. Rules: docs/harness/conventions/plans.md → "The initiative README".
     Status is NOT tracked here: run `pnpm plans:status attendance-asistencia-diaria`. -->

## Goal

HR defines the shifts (turnos) of each company — fixed, rotating and night shifts — and assigns
one to each colaborador from a given date. On top of the marcaciones already attributed by RFC
(series `attendance-marcaciones`), the API builds and stores each colaborador's jornada per day:
entry, exit, lateness (retardo), absence (falta), incomplete days and the time worked past the
shift's end (horas extra, measured only). The stored jornadas are recalculated when a late punch
arrives or an assignment changes, so periods can later be closed for payroll.

## Plans

| Plan                                          | Title                        | Depends on                          | Purpose                                                                                                                                                      |
| --------------------------------------------- | ---------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [001](001-catalogo-de-turnos-y-asignacion.md) | Shift catalog and assignment | —                                   | Company-owned shifts as a cyclic pattern (work/rest days, tolerance, meal break); assign one to a colaborador from a date.                                   |
| [002](002-jornada-diaria-guardada.md)         | Stored daily jornada         | 001, employees-fechas-laborales/001 | Calculate and store each day (entry/exit, retardo, falta, horas extra measured, descanso trabajado); recalculate a range on demand; read it.                 |
| [003](003-recalculo-automatico.md)            | Automatic recalculation      | 002                                 | Recalculate on new punches and assignment changes; daily close with a scheduled job (ADR). Must serialize recalculations per colaborador (002 review Low-2). |
| 004 (not written)                             | N retardos = 1 falta         | 002                                 | Per-company rule (N and period) that turns accumulated retardos into a falta.                                                                                |

## Dependency notes

002 resolves "which shift day applies to a colaborador on date D" with what 001 stores
(`Shift.dayOn` and the assignment history), so 001 must be `done` first. It also needs the hire
and termination dates from `employees-fechas-laborales/001` (decision 18). 003 calls the
recalculation of 002 from its triggers; 004 reads the retardos that 002 stores.

## Decisions with the user

1. (2026-10-14) This series follows `employees-desvinculacion`: shifts and daily attendance on
   top of the attributed marcaciones.
2. (2026-10-14) Shifts may be **fixed, rotating and night shifts** (crossing midnight); all three
   must be representable.
3. (2026-10-14) A shift is assigned **to each colaborador** (not per sede), with the date from
   which it applies (history kept).
4. (2026-10-14) The punch `status` code sent by the checador is **not used**: in the dev database
   the real SenseFace sent `status=0` on 4 of 5 punches and `4` on one, with nobody choosing a
   key. A day's first punch is the entry and its last punch is the exit (applies in 002).
5. (2026-10-14) The meal break **is not punched**: the shift defines a fixed meal time that is
   deducted (0 = none).
6. (2026-10-14) The lateness **tolerance is configured per shift** (minutes).
7. (2026-10-14) A **falta** is: a working day without punches; a day with a single punch; and N
   retardos in a period (decision 8).
8. (2026-10-14) "N retardos = 1 falta" is **configurable per company** (N and the period).
9. (2026-10-14) **Horas extra are only measured** in this series (time worked past the shift's
   end); authorization and double/triple pay (LFT arts. 67–68) belong to payroll or a later
   series.
10. (2026-10-14) The daily jornada is **stored and recalculated** (not computed on every read), so
    periods can be closed for payroll later.
11. (2026-10-14) Shifts **belong to each company**: HR of a company manages its shifts and can
    assign them only to that company's colaboradores.
12. (2026-10-14) A shift is a **cyclic pattern**: N days, each a working day (entry, exit) or a
    rest day, anchored to a start date. A night shift (22:00–06:00) belongs to the day it starts.
13. (2026-10-14) Series split: 001 catalog + assignment, 002 stored jornada, 003 the N-retardos
    rule. Superseded by decision 19.
14. (2026-10-14) **Horas extra = time worked above the day's jornada**, not only after the shift's
    end: worked = exit − entry − meal; overtime = worked − the shift day's work minutes.
    Arriving early counts (09:00–18:00 with 60 min meal: 08:00–18:00 → 1 h extra; 09:30–19:30 →
    0 extra and a 30 min retardo). Refines decision 9.
15. (2026-10-14) **Retardo minutes are counted from the shift's start**; the tolerance only
    decides whether there is a retardo (09:00, tolerance 10, entry 09:15 → 15 min).
16. (2026-10-14) Punches on a rest day are stored as **descanso trabajado**, with all their
    worked time measured as overtime; its pay (prima dominical, double pay) belongs to payroll.
17. (2026-10-14) The window that assigns a night shift's punches to its day is a **theoretical
    rule for now** (proposed by the architect, plan 002 "The punch window"), with a fixed 4 h
    margin that can become configurable later.
18. (2026-10-14) Jornadas exist only **between the hire date and the termination date**; the
    dates come from employees (`employees-fechas-laborales/001`).
19. (2026-10-14) Series re-split: 002 calculation + storage + on-demand recalculation of a range +
    read; 003 automatic recalculation (new punches, assignment changes, daily close with a
    scheduled job and its ADR); 004 the N-retardos rule.
20. (2026-10-14) **Automatic recalculation reaches at most 62 days back** (e.g. a shift assigned
    six months back is recalculated only for the last 62 days); older dates are recalculated by
    hand with the 002 endpoint, so periods that may already be paid are not rewritten silently.
21. (2026-10-14) The **close sweep runs every hour**, recalculating the last days of every
    colaborador with a shift, so a falta appears at most about an hour after its window closes.
22. (2026-10-14) **No company-wide (bulk) recalculation** in this series for now; it is added
    when there is a UI that needs it.

## Delivered

## Considered and discarded

- **Using the checador's status key (entrada/salida/comida)**: the real device sends `0` by
  default and nobody chooses a key. Discarded by decision 4.
- **Shift per sede (with or without individual exceptions)**: discarded by decision 3.
- **Computing the jornada on every read**: simpler, but no period close and every report
  recomputes everything. Discarded by decision 10.
- **Separate models for fixed / rotating / night shifts**: three shapes to store and resolve; the
  cyclic pattern covers all three (a fixed Mon–Fri shift is a 7-day cycle anchored on a Monday).
  Discarded by decision 12.
- **Overtime only after the shift's end**: discarded by decision 14.
- **Recalculating each punch as it arrives, inside plan 002**: needs the triggers and the daily
  close anyway (faltas have no punch to trigger them). Moved to plan 003 by decision 19.
- **Unlimited retroactive automatic recalculation**: would rewrite periods that may already be
  paid. Discarded by decision 20.
- **A once-a-day close**: faltas would appear only the next day. Discarded by decision 21.
- **Company-wide recalculation endpoint**: discarded for now by decision 22.
