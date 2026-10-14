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

| Plan                                          | Title                        | Depends on | Purpose                                                                                                                    |
| --------------------------------------------- | ---------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| [001](001-catalogo-de-turnos-y-asignacion.md) | Shift catalog and assignment | —          | Company-owned shifts as a cyclic pattern (work/rest days, tolerance, meal break); assign one to a colaborador from a date. |
| 002 (not written)                             | Stored daily jornada         | 001        | Build and store each day: entry/exit, retardo, falta, incomplete, horas extra measured; recalculate on new punches.        |
| 003 (not written)                             | N retardos = 1 falta         | 002        | Per-company rule (N and period) that turns accumulated retardos into a falta.                                              |

## Dependency notes

002 resolves "which shift day applies to a colaborador on date D" with what 001 stores
(`Shift.dayOn` and the assignment history), so 001 must be `done` first. 003 reads the retardos
that 002 stores.

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
    rule.

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
