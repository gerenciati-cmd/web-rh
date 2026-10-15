import type { ShiftAssignment } from './shift-assignment';

export interface ShiftAssignmentRepository {
  /**
   * Inserta la asignación o, si el colaborador ya tiene una en esa `effectiveFrom`, reemplaza su
   * turno, fecha y autor de la asignación.
   */
  put(assignment: ShiftAssignment): Promise<void>;
  /** Historial de asignaciones del colaborador, de la `effectiveFrom` más antigua a la más reciente. */
  listByEmployee(employeeId: string): Promise<ShiftAssignment[]>;
  /** Colaboradores distintos con al menos una asignación (para el cierre horario de jornadas). */
  listAssignedEmployees(): Promise<{ employeeId: string; companyId: string }[]>;
}
