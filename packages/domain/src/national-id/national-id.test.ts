import { describe, expect, it } from 'vitest';

import { NationalId } from './national-id';

describe('NationalId', () => {
  describe('Chile (RUT)', () => {
    it.each(['12.345.678-5', '12345678-5', '123456785', '7.654.321-6'])(
      'acepta el RUT válido %s',
      (raw) => {
        expect(NationalId.create('CL', raw).ok).toBe(true);
      },
    );

    it('acepta dígito verificador K en minúscula', () => {
      const result = NationalId.create('CL', '10.000.013-k');
      expect(result.ok && result.value.value).toBe('10000013K');
    });

    it.each(['12.345.678-9', 'abc', '', '1-9'])('rechaza %s', (raw) => {
      expect(NationalId.create('CL', raw).ok).toBe(false);
    });

    it('normaliza y formatea', () => {
      const result = NationalId.create('CL', '123456785');
      expect(result.ok && result.value.format()).toBe('12.345.678-5');
    });
  });

  describe('Perú (DNI)', () => {
    it('acepta 8 dígitos', () => {
      expect(NationalId.isValid('PE', '12345678')).toBe(true);
    });

    it('rechaza largo distinto de 8', () => {
      expect(NationalId.isValid('PE', '1234567')).toBe(false);
    });
  });
});
