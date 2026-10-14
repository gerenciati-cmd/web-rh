import type { ShiftAssignment } from './shift-assignment';

export interface ShiftAssignmentRepository {
  /**
   * Inserta la asignación o, si el colaborador ya tiene una en esa `effectiveFrom`, reemplaza su
   * turno, fecha y autor de la asignación.
   */
  put(assignment: ShiftAssignment): Promise<void>;
}
