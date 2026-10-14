import { describe, expect, it } from 'vitest';

import { addDays, daysBetween, localInstant } from './local-date';

describe('addDays', () => {
  it('suma días dentro del mes', () => {
    expect(addDays('2026-10-05', 3)).toBe('2026-10-08');
  });

  it('cruza fin de mes y de año', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('resta con días negativos', () => {
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('respeta el año bisiesto', () => {
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('cero días devuelve la misma fecha', () => {
    expect(addDays('2026-10-05', 0)).toBe('2026-10-05');
  });
});

describe('daysBetween', () => {
  it('cuenta los días de una fecha a otra', () => {
    expect(daysBetween('2026-10-05', '2026-10-11')).toBe(6);
  });

  it('es 0 para la misma fecha y negativo si la final es anterior', () => {
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
    expect(daysBetween('2026-10-11', '2026-10-05')).toBe(-6);
  });

  it('cruza meses y años', () => {
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
  });
});

describe('localInstant', () => {
  it('convierte la hora de pared de Cancún (UTC−5, sin horario de verano) a UTC', () => {
    expect(localInstant('2026-10-05', '09:00', 'America/Cancun').toISOString()).toBe(
      '2026-10-05T14:00:00.000Z',
    );
  });

  it('usa el desfase vigente de la fecha en una zona con horario de verano', () => {
    expect(localInstant('2026-07-01', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-07-01T13:00:00.000Z',
    );
    expect(localInstant('2026-01-15', '09:00', 'America/New_York').toISOString()).toBe(
      '2026-01-15T14:00:00.000Z',
    );
  });

  it('una zona inválida lanza (la zona viene de una sede ya validada)', () => {
    expect(() => localInstant('2026-10-05', '09:00', 'No/Existe')).toThrow();
  });
});
