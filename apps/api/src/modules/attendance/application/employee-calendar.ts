import { addDays } from '../domain/local-date';
import type { Shift, ShiftId } from '../domain/shift';
import type { ShiftAssignment } from '../domain/shift-assignment';
import type { ShiftAssignmentRepository } from '../domain/shift-assignment.repository';
import type { ShiftRepository } from '../domain/shift.repository';
import type { PlannedDate } from '../domain/workday-calculator';

/** Asignación vigente en `date`: la más reciente con `effectiveFrom ≤ date` (historial ascendente). */
export function assignmentOn(
  assignments: readonly ShiftAssignment[],
  date: string,
): ShiftAssignment | null {
  let current: ShiftAssignment | null = null;
  for (const assignment of assignments) {
    if (assignment.effectiveFrom > date) break;
    current = assignment;
  }
  return current;
}

/** Fechas consecutivas de `from − 1` a `from + span + 1` con el turno vigente de cada una. */
export async function buildEmployeeCalendar(
  deps: {
    shiftAssignmentRepository: ShiftAssignmentRepository;
    shiftRepository: ShiftRepository;
  },
  employeeId: string,
  from: string,
  span: number,
): Promise<PlannedDate[]> {
  const assignments = await deps.shiftAssignmentRepository.listByEmployee(employeeId);
  const dates = Array.from({ length: span + 3 }, (_, index) => addDays(from, index - 1));
  const applied = dates.map((date) => ({ date, assignment: assignmentOn(assignments, date) }));

  const shifts = new Map<ShiftId, Shift>();
  for (const { assignment } of applied) {
    if (!assignment || shifts.has(assignment.shiftId)) continue;
    const shift = await deps.shiftRepository.findById(assignment.shiftId);
    // La asignación referencia el turno con FK: que falte es corrupción, no un caso de negocio.
    if (!shift) throw new Error(`El turno ${assignment.shiftId} asignado no existe`);
    shifts.set(assignment.shiftId, shift);
  }

  return applied.map(({ date, assignment }): PlannedDate => {
    const shift = assignment ? shifts.get(assignment.shiftId) : undefined;
    return {
      date,
      plan: shift
        ? { shiftId: shift.id, day: shift.dayOn(date), toleranceMinutes: shift.toleranceMinutes }
        : null,
    };
  });
}
