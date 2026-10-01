import { InvalidValueError } from './errors';
import { err, ok, type Result } from './result';

/** `true` si `timeZone` es un identificador IANA que el runtime reconoce (p. ej. `America/Cancun`). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

/** Desfase (ms) de `timeZone` respecto a UTC en el instante `ms`: hora de pared − `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(ms));
  const value = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const wall = Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
  return wall - ms;
}

/**
 * Convierte la hora local de pared de un equipo (`YYYY-MM-DD HH:mm:ss`, sin offset) al instante UTC
 * según su zona horaria IANA. Se resuelve con dos pasadas del desfase, que es determinista también
 * en horas ambiguas o inexistentes por cambio de horario.
 */
export function localDateTimeToUtc(
  local: string,
  timeZone: string,
): Result<Date, InvalidValueError> {
  const match = LOCAL_DATE_TIME.exec(local);
  if (!match) return err(new InvalidValueError('Fecha y hora del equipo inválida'));
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(naive);
  const isRealCalendarTime =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
  if (!isRealCalendarTime) return err(new InvalidValueError('Fecha y hora del equipo inválida'));
  if (!isValidTimeZone(timeZone)) return err(new InvalidValueError('Zona horaria inválida'));

  const first = naive - offsetAt(naive, timeZone);
  return ok(new Date(naive - offsetAt(first, timeZone)));
}
