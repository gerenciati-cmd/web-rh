import { describe, expect, it } from 'vitest';

import { CountrySchema } from './common';

describe('CountrySchema', () => {
  it.each(['MX', 'DO', 'CO'] as const)('acepta %s (país soportado)', (country) => {
    expect(CountrySchema.safeParse(country).success).toBe(true);
  });

  it.each(['CL', 'PE'])('rechaza %s (país ya no soportado, ADR 0009)', (country) => {
    expect(CountrySchema.safeParse(country).success).toBe(false);
  });

  it('rechaza cualquier otro código de país', () => {
    expect(CountrySchema.safeParse('US').success).toBe(false);
  });
});
