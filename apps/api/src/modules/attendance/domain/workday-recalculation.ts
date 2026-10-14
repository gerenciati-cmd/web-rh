import { MAX_WORKDAY_RANGE_DAYS } from '@rrhh/domain';

import { addDays } from './local-date';

/**
 * Rangos del recálculo automático de jornadas (README de attendance-asistencia-diaria,
 * decisiones 19–21). Todo rango automático se acota a los últimos `MAX_WORKDAY_RANGE_DAYS` días
 * hasta hoy (fecha UTC), y el cierre horario recalcula solo los últimos `SWEEP_DAYS`.
 */
export const SWEEP_DAYS = 3;

/** Fecha UTC (`YYYY-MM-DD`) de un instante. */
export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Acota `[from, to]` a `[today − (MAX_WORKDAY_RANGE_DAYS − 1), today]`; `null` si no queda
 * ninguna fecha (el rango termina antes del piso o empieza después de hoy).
 */
export function automaticRange(
  from: string,
  to: string,
  today: string,
): { from: string; to: string } | null {
  const floor = addDays(today, -(MAX_WORKDAY_RANGE_DAYS - 1));
  const clampedFrom = from > floor ? from : floor;
  const clampedTo = to < today ? to : today;
  if (clampedFrom > clampedTo) return null;
  return { from: clampedFrom, to: clampedTo };
}

/** Rango del cierre horario: los últimos `SWEEP_DAYS` días hasta hoy. */
export function sweepRange(today: string): { from: string; to: string } {
  return { from: addDays(today, -(SWEEP_DAYS - 1)), to: today };
}
