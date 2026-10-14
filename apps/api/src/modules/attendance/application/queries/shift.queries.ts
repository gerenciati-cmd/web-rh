import type { Page, PageQuery, ShiftAssignmentDto, ShiftDto } from '@rrhh/contracts';

/** Lecturas de turnos y asignaciones para pantallas; no tocan el dominio. */
export interface ShiftQueries {
  /** Turnos de una empresa, ordenados por nombre (y `id` para desempatar). */
  listShifts(companyId: string, page: PageQuery): Promise<Page<ShiftDto>>;
  /** Asignaciones de un colaborador, de la `effectiveFrom` más reciente a la más antigua. */
  listAssignments(employeeId: string, page: PageQuery): Promise<Page<ShiftAssignmentDto>>;
}
