import { MAX_WORKDAY_RANGE_DAYS } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { addDays } from './local-date';
import { automaticRange, SWEEP_DAYS, sweepRange, utcDate } from './workday-recalculation';

const TODAY = '2026-10-14';

describe('utcDate', () => {
  it('devuelve la fecha UTC del instante, no la local', () => {
    // 23:30 en Cancún (UTC−5) del 13 ya es 04:30Z del 14.
    expect(utcDate(new Date('2026-10-14T04:30:00Z'))).toBe('2026-10-14');
    expect(utcDate(new Date('2026-10-13T23:59:59.999Z'))).toBe('2026-10-13');
  });
});

describe('automaticRange', () => {
  it('deja intacto un rango que cabe entre el piso y hoy', () => {
    expect(automaticRange('2026-10-01', '2026-10-10', TODAY)).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
  });

  it('acota el final a hoy cuando termina en el futuro', () => {
    expect(automaticRange('2026-10-12', '2026-11-30', TODAY)).toEqual({
      from: '2026-10-12',
      to: TODAY,
    });
  });

  it('acota el inicio al piso de 62 fechas (hoy − 61)', () => {
    const floor = addDays(TODAY, -(MAX_WORKDAY_RANGE_DAYS - 1));
    expect(floor).toBe('2026-08-14');

    expect(automaticRange('2026-01-01', TODAY, TODAY)).toEqual({ from: floor, to: TODAY });
  });

  it('el piso y hoy son inclusivos: el rango máximo tiene exactamente 62 fechas', () => {
    const range = automaticRange('2000-01-01', '2100-01-01', TODAY);

    expect(range).toEqual({ from: '2026-08-14', to: TODAY });
    expect(range && daysInclusive(range)).toBe(MAX_WORKDAY_RANGE_DAYS);
  });

  it('un rango de un solo día en el piso o en hoy se conserva', () => {
    expect(automaticRange('2026-08-14', '2026-08-14', TODAY)).toEqual({
      from: '2026-08-14',
      to: '2026-08-14',
    });
    expect(automaticRange(TODAY, TODAY, TODAY)).toEqual({ from: TODAY, to: TODAY });
  });

  it('devuelve null si el rango termina antes del piso', () => {
    expect(automaticRange('2026-01-01', '2026-08-13', TODAY)).toBeNull();
  });

  it('devuelve null si el rango empieza después de hoy', () => {
    expect(automaticRange('2026-10-15', '2026-10-20', TODAY)).toBeNull();
  });

  it('devuelve null si el rango viene invertido', () => {
    expect(automaticRange('2026-10-10', '2026-10-05', TODAY)).toBeNull();
  });
});

describe('sweepRange', () => {
  it('cubre los últimos SWEEP_DAYS días hasta hoy', () => {
    expect(SWEEP_DAYS).toBe(3);
    expect(sweepRange(TODAY)).toEqual({ from: '2026-10-12', to: TODAY });
  });

  it('cruza el cambio de mes y de año', () => {
    expect(sweepRange('2026-11-01')).toEqual({ from: '2026-10-30', to: '2026-11-01' });
    expect(sweepRange('2027-01-01')).toEqual({ from: '2026-12-30', to: '2027-01-01' });
  });
});

function daysInclusive(range: { from: string; to: string }): number {
  const ms = Date.parse(`${range.to}T00:00:00Z`) - Date.parse(`${range.from}T00:00:00Z`);
  return ms / 86_400_000 + 1;
}
