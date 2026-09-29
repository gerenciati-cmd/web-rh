import { describe, expect, it } from 'vitest';

import { CreateCompanySchema } from './company.contract';

describe('CreateCompanySchema', () => {
  const base = { legalName: 'APS Holding S.A. de C.V.' };

  it.each([
    ['MX', 'EKU9003173C9'],
    ['DO', '131246796'],
    ['CO', '900.123.456-8'],
  ] as const)('acepta un %s con identificador tributario válido', (country, taxId) => {
    const result = CreateCompanySchema.safeParse({ ...base, taxId, country });
    expect(result.success).toBe(true);
  });

  it('rechaza un identificador tributario inválido con el error en taxId (usa TaxId.isValid)', () => {
    const result = CreateCompanySchema.safeParse({ ...base, taxId: '900123456-9', country: 'CO' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['taxId']);
  });

  it('rechaza un país no soportado antes de llegar al refine de TaxId', () => {
    const result = CreateCompanySchema.safeParse({ ...base, taxId: 'EKU9003173C9', country: 'CL' });
    expect(result.success).toBe(false);
  });
});
