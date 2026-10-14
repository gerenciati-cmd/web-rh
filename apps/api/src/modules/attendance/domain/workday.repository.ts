import type { Workday } from './workday';

export interface WorkdayRepository {
  /**
   * Borra las jornadas del colaborador en esas fechas e inserta `workdays` (todas con fecha dentro
   * de `dates`), de forma atómica: una fecha recalculada sin jornada queda sin fila.
   */
  replaceDates(
    employeeId: string,
    dates: readonly string[],
    workdays: readonly Workday[],
  ): Promise<void>;
}
