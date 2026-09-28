import { describe, expect, it } from 'vitest';

import { normalizeIdentifier, SUPPORTED_COUNTRIES } from './country';

describe('SUPPORTED_COUNTRIES', () => {
  it('son exactamente MX, DO y CO (ADR 0009)', () => {
    expect(SUPPORTED_COUNTRIES).toEqual(['MX', 'DO', 'CO']);
  });
});

describe('normalizeIdentifier', () => {
  it('quita puntos, guiones y espacios, y pasa a mayúsculas', () => {
    expect(normalizeIdentifier('900.123.456-8')).toBe('9001234568');
    expect(normalizeIdentifier('goma850101hqrrrn04')).toBe('GOMA850101HQRRRN04');
    expect(normalizeIdentifier('  1 2 3  ')).toBe('123');
  });

  it('conserva Ñ y &', () => {
    expect(normalizeIdentifier('a&ñ.010101-aaa')).toBe('A&Ñ010101AAA');
  });
});
