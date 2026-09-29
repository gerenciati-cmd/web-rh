import { describe, expect, it } from 'vitest';

import { RegisterEmployeeSchema } from './employee.contract';

describe('RegisterEmployeeSchema', () => {
  const base = {
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'ana@example.com',
    hireDate: '2026-01-10',
  };

  it('acepta una CURP válida (México)', () => {
    const result = RegisterEmployeeSchema.safeParse({
      ...base,
      nationalId: { country: 'MX', number: 'goma850101hqrrrn04' },
    });
    expect(result.success).toBe(true);
  });

  it('rechaza una CURP con dígito verificador incorrecto, con el error en nationalId.number (usa NationalId.isValid)', () => {
    const result = RegisterEmployeeSchema.safeParse({
      ...base,
      nationalId: { country: 'MX', number: 'GOMA850101HQRRRN05' },
    });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['nationalId', 'number']);
  });

  it('rechaza una CURP cuya fecha de nacimiento no existe en el calendario', () => {
    const result = RegisterEmployeeSchema.safeParse({
      ...base,
      // Dígito verificador correcto (2): aísla solo la regla de fecha inválida.
      nationalId: { country: 'MX', number: 'GOMA850230HQRRRN02' },
    });
    expect(result.success).toBe(false);
  });

  it('rechaza un país no soportado antes de llegar al refine de NationalId', () => {
    const result = RegisterEmployeeSchema.safeParse({
      ...base,
      nationalId: { country: 'CL', number: '12.345.678-5' },
    });
    expect(result.success).toBe(false);
  });
});
