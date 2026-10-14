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
  /**
   * Toma un candado sobre el colaborador que dura hasta que termina la transacción que lo rodea:
   * los recálculos concurrentes del mismo colaborador esperan en vez de chocar.
   */
  lockEmployee(employeeId: string): Promise<void>;
}
