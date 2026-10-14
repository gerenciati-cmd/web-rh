import type { ShiftId } from './shift';

/**
 * Turno de un colaborador desde una fecha: el historial de asignaciones dice qué turno aplica en
 * cada día. Valor plano, sin comportamiento.
 */
export interface ShiftAssignment {
  employeeId: string;
  companyId: string;
  shiftId: ShiftId;
  /** Fecha (`YYYY-MM-DD`) desde la que aplica el turno. */
  effectiveFrom: string;
  assignedAt: Date;
  assignedBy: string;
}
