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
    expect(clp(100).add(clp(200)).amountMinor).toBe(300);
  });

  it('rechaza montos no enteros', () => {
    expect(Money.ofMinor(10.5, 'CLP').ok).toBe(false);
  });

  it('no permite mezclar monedas', () => {
    const usd = Money.zero('USD');
    expect(() => clp(1).add(usd)).toThrow();
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
