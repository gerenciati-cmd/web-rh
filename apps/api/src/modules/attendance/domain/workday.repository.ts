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
   * Jornadas guardadas del colaborador con fecha en `[from, to]` (ambas `YYYY-MM-DD`, inclusive),
   * de la más antigua a la más reciente. Las usa la regla de N retardos para recontar un tramo.
   */
  listBetween(employeeId: string, from: string, to: string): Promise<Workday[]>;
  /**
   * Toma un candado sobre el colaborador que dura hasta que termina la transacción que lo rodea:
   * los recálculos concurrentes del mismo colaborador esperan en vez de chocar.
   */
  lockEmployee(employeeId: string): Promise<void>;
}
