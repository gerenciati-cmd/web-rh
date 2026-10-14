import type { WorkdayDto } from '@rrhh/contracts';

/** Lecturas de jornadas guardadas para pantallas; no tocan el dominio. */
export interface WorkdayQueries {
  /** Jornadas del colaborador entre `from` y `to` (inclusive), por fecha ascendente. */
  listByEmployee(employeeId: string, from: string, to: string): Promise<WorkdayDto[]>;
}
