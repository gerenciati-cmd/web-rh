import type { WorkdayStatus } from '@rrhh/domain';

import type { ShiftId } from './shift';

/**
 * Jornada calculada de un colaborador en una fecha (el día en que empieza su turno). Valor plano,
 * sin comportamiento: se recalcula completa y reemplaza a la guardada.
 */
export interface Workday {
  employeeId: string;
  companyId: string;
  /** Fecha `YYYY-MM-DD` de la jornada. */
  date: string;
  shiftId: ShiftId;
  status: WorkdayStatus;
  /** Entrada y salida programadas; null en descanso trabajado. */
  scheduledStartAt: Date | null;
  scheduledEndAt: Date | null;
  /** Minutos programados sin la comida; 0 en descanso trabajado. */
  scheduledMinutes: number;
  firstPunchAt: Date | null;
  lastPunchAt: Date | null;
  punchCount: number;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
  calculatedAt: Date;
}
