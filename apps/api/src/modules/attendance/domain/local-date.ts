import { localDateTimeToUtc } from '@rrhh/domain';

const MS_PER_DAY = 86_400_000;

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

/** Suma `days` días (negativos restan) a una fecha `YYYY-MM-DD`. */
export function addDays(date: string, days: number): string {
  return new Date(utcDay(date) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Días de `from` a `to` (`YYYY-MM-DD`): 0 si son iguales, negativo si `to` es anterior. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcDay(to) - utcDay(from)) / MS_PER_DAY);
}

/**
 * Instante UTC de la hora de pared `time` (`HH:mm`) del día `date` en la zona `timeZone`. La zona
 * viene de una sede ya validada y la hora de un turno validado: un error aquí es inesperado.
 */
export function localInstant(date: string, time: string, timeZone: string): Date {
  const result = localDateTimeToUtc(`${date} ${time}:00`, timeZone);
  if (!result.ok) throw result.error;
  return result.value;
}
