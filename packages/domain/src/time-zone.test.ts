import { describe, expect, it } from 'vitest';

import { isValidTimeZone, localDateTimeToUtc } from './time-zone';

function utc(local: string, timeZone: string): string {
  const result = localDateTimeToUtc(local, timeZone);
  if (!result.ok) throw result.error;
  return result.value.toISOString();
}

describe('isValidTimeZone', () => {
  it.each(['America/Cancun', 'America/Mexico_City', 'UTC'])('acepta %s', (timeZone) => {
    expect(isValidTimeZone(timeZone)).toBe(true);
  });

  it.each(['Mars/Olympus', '', 'no es zona'])('rechaza %j', (timeZone) => {
    expect(isValidTimeZone(timeZone)).toBe(false);
  });
});

describe('localDateTimeToUtc', () => {
  it('convierte la marcación observada en el equipo real (Cancún, UTC−5)', () => {
    expect(utc('2026-09-28 12:17:29', 'America/Cancun')).toBe('2026-09-28T17:17:29.000Z');
  });

  it('respeta el horario de verano de la zona (Nueva York: EDT en julio, EST en enero)', () => {
    expect(utc('2026-07-01 12:00:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
    expect(utc('2026-01-15 12:00:00', 'America/New_York')).toBe('2026-01-15T17:00:00.000Z');
  });

  it('cruza el día cuando el desfase lo exige', () => {
    expect(utc('2026-12-31 23:59:59', 'America/Cancun')).toBe('2027-01-01T04:59:59.000Z');
  });

  it('acepta el 29 de febrero de un año bisiesto', () => {
    expect(utc('2028-02-29 00:00:00', 'UTC')).toBe('2028-02-29T00:00:00.000Z');
  });

  it('es determinista en la hora inexistente del cambio de horario (se lee como EST)', () => {
    expect(utc('2026-03-08 02:30:00', 'America/New_York')).toBe('2026-03-08T06:30:00.000Z');
  });

  it('es determinista en la hora ambigua del cambio de horario (primera ocurrencia, EDT)', () => {
    expect(utc('2026-11-01 01:30:00', 'America/New_York')).toBe('2026-11-01T05:30:00.000Z');
  });

  it.each([
    '2026-02-30 08:00:00',
    '2026-13-01 08:00:00',
    '2026-02-28 24:00:00',
    '2026-02-28 08:60:00',
    '2026-02-28 08:00:60',
    '2027-02-29 00:00:00',
  ])('rechaza la fecha imposible %s', (local) => {
    const result = localDateTimeToUtc(local, 'America/Cancun');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe('Fecha y hora del equipo inválida');
  });

  it.each([
    '2026-09-28T12:17:29',
    '2026-09-28 12:17',
    '28/09/2026 12:17:29',
    '',
    ' 2026-09-28 12:17:29',
  ])('rechaza el formato %j', (local) => {
    const result = localDateTimeToUtc(local, 'America/Cancun');
    expect(!result.ok && result.error.message).toBe('Fecha y hora del equipo inválida');
  });

  it('rechaza una zona horaria inválida', () => {
    const result = localDateTimeToUtc('2026-09-28 12:17:29', 'Mars/Olympus');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.message).toBe('Zona horaria inválida');
  });
});
