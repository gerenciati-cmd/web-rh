import { describe, expect, it } from 'vitest';

import { DateRange } from './date-range';
import { Money } from './money';

const clp = (amount: number) => {
  const result = Money.ofMinor(amount, 'CLP');
  if (!result.ok) throw result.error;
  return result.value;
};

const range = (from: string, to: string | null) => {
  const result = DateRange.create(new Date(from), to ? new Date(to) : null);
  if (!result.ok) throw result.error;
  return result.value;
};

describe('Money', () => {
  it('suma sin errores de punto flotante', () => {
    const sum = clp(100).add(clp(200));
    expect(sum.ok && sum.value.amountMinor).toBe(300);
  });

  it('rechaza montos no enteros', () => {
    expect(Money.ofMinor(10.5, 'CLP').ok).toBe(false);
  });

  it('no permite mezclar monedas', () => {
    const usd = Money.zero('USD');
    expect(clp(1).add(usd).ok).toBe(false);
    expect(clp(1).subtract(usd).ok).toBe(false);
  });

  it('formatea según los decimales de la moneda', () => {
    const result = Money.ofMinor(12345, 'USD');
    expect(result.ok && result.value.toDecimalString()).toBe('123.45');
  });
});

describe('DateRange', () => {
  it('rechaza término anterior al inicio', () => {
    expect(DateRange.create(new Date('2026-02-01'), new Date('2026-01-01')).ok).toBe(false);
  });

  it('detecta solapamiento con rango abierto', () => {
    expect(range('2026-01-01', null).overlaps(range('2030-01-01', '2030-02-01'))).toBe(true);
  });

  it('rangos contiguos no se solapan (fin exclusivo)', () => {
    expect(range('2026-01-01', '2026-02-01').overlaps(range('2026-02-01', null))).toBe(false);
  });
});

describe('invariantes de valor', () => {
  it('rechaza overflow en cada operación monetaria', () => {
    expect(clp(Number.MAX_SAFE_INTEGER).add(clp(1)).ok).toBe(false);
    expect(clp(Number.MIN_SAFE_INTEGER).subtract(clp(1)).ok).toBe(false);
    expect(clp(Number.MAX_SAFE_INTEGER).multiply(2).ok).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])('rechaza factor no finito %s', (factor) => {
    expect(clp(10).multiply(factor).ok).toBe(false);
  });
  it.each([
    [3, 0.5, 2],
    [-3, 0.5, -1],
    [10, -2, -20],
    [10, 0, 0],
  ])('mantiene Math.round(%s × %s)', (amount, factor, expected) => {
    const result = clp(amount).multiply(factor);
    expect(result.ok && result.value.amountMinor).toBe(expected);
  });
  it('resta válida y resultado negativo', () => {
    const result = clp(10).subtract(clp(20));
    expect(result.ok && result.value.amountMinor).toBe(-10);
  });
  it('rechaza fechas inválidas e intervalos vacíos', () => {
    const valid = new Date('2026-01-01');
    expect(DateRange.create(new Date(NaN), null).ok).toBe(false);
    expect(DateRange.create(valid, new Date(NaN)).ok).toBe(false);
    expect(DateRange.create(valid, valid).ok).toBe(false);
    expect(range('2026-01-01', null).contains(new Date(NaN))).toBe(false);
  });
  it('ni las entradas ni los getters pueden mutar los extremos', () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-02-01');
    const result = DateRange.create(from, to);
    if (!result.ok) throw result.error;
    from.setFullYear(2030);
    to.setFullYear(2030);
    result.value.from.setFullYear(2040);
    result.value.to?.setFullYear(2040);
    expect(result.value.from.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(result.value.to?.toISOString()).toBe('2026-02-01T00:00:00.000Z');
    expect(result.value.contains(new Date('2026-01-01'))).toBe(true);
    expect(result.value.contains(new Date('2026-02-01'))).toBe(false);
  });
});
