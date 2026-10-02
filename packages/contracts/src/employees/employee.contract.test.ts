import { describe, expect, it } from 'vitest';

import {
  AssignEmployeeRfcSchema,
  employeeRoutes,
  RegisterEmployeeSchema,
} from './employee.contract';

describe('RegisterEmployeeSchema › RFC', () => {
  const base = {
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'ana@example.com',
    hireDate: '2026-01-10',
    siteId: '019b1c2e-0000-7000-8000-000000000001',
  };
  const mx = { country: 'MX', number: 'GOMA850101HQRRRN04' };
  const dominican = { country: 'DO', number: '00113918205' };
  const colombian = { country: 'CO', number: '1020304050' };

  it('México: acepta un RFC válido en minúsculas (se normaliza en el caso de uso)', () => {
    const result = RegisterEmployeeSchema.safeParse({
      ...base,
      nationalId: mx,
      rfc: 'goma850101ab1',
    });
    expect(result.success).toBe(true);
  });

  it('México: rechaza la falta de RFC con el error en rfc', () => {
    const result = RegisterEmployeeSchema.safeParse({ ...base, nationalId: mx });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['rfc']);
    expect(!result.success && result.error.issues[0]?.message).toBe(
      'RFC obligatorio y válido para colaboradores de México',
    );
  });

  it.each([
    ['formato inválido', 'ABC'],
    ['mes inexistente', 'GOMA851301AB1'],
    ['RFC de persona moral', 'EKU9003173C9'],
  ])('México: rechaza un RFC con %s, con el error en rfc', (_case, rfc) => {
    const result = RegisterEmployeeSchema.safeParse({ ...base, nationalId: mx, rfc });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['rfc']);
  });

  it.each([
    ['DO', dominican],
    ['CO', colombian],
  ])('%s: acepta el alta sin RFC', (_country, nationalId) => {
    expect(RegisterEmployeeSchema.safeParse({ ...base, nationalId }).success).toBe(true);
  });

  it.each([
    ['DO', dominican],
    ['CO', colombian],
  ])('%s: rechaza un RFC con el error en rfc', (_country, nationalId) => {
    const result = RegisterEmployeeSchema.safeParse({ ...base, nationalId, rfc: 'GOMA850101AB1' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['rfc']);
    expect(!result.success && result.error.issues[0]?.message).toBe(
      'El RFC solo aplica a colaboradores de México',
    );
  });
});

describe('AssignEmployeeRfcSchema', () => {
  it('acepta un RFC válido y recorta espacios', () => {
    const result = AssignEmployeeRfcSchema.safeParse({ rfc: '  goma850101ab1  ' });
    expect(result.success && result.data.rfc).toBe('goma850101ab1');
  });

  it.each([['GOMA851301AB1'], ['EKU9003173C9'], [''], ['   ']])(
    'rechaza %j con el error en rfc',
    (rfc) => {
      const result = AssignEmployeeRfcSchema.safeParse({ rfc });
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0]?.path).toEqual(['rfc']);
    },
  );

  it('exige el campo rfc', () => {
    expect(AssignEmployeeRfcSchema.safeParse({}).success).toBe(false);
  });
});

describe('employeeRoutes.assignEmployeeRfc', () => {
  const route = employeeRoutes.assignEmployeeRfc;

  it('es PUT /companies/:companyId/employees/:employeeId/rfc con 204', () => {
    expect(route.method).toBe('PUT');
    expect(route.path).toBe('/companies/:companyId/employees/:employeeId/rfc');
    expect(route.successStatus).toBe(204);
  });

  it('exige employees:update acotado a la empresa del path', () => {
    expect(route.access).toEqual({
      kind: 'permission',
      permission: 'employees:update',
      companyParam: 'companyId',
    });
  });

  it('valida que companyId y employeeId sean uuid', () => {
    const uuid = '00000000-0000-4000-8000-000000000001';
    expect(route.params.safeParse({ companyId: uuid, employeeId: uuid }).success).toBe(true);
    expect(route.params.safeParse({ companyId: uuid, employeeId: 'x' }).success).toBe(false);
  });
});

describe('RegisterEmployeeSchema', () => {
  const base = {
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'ana@example.com',
    hireDate: '2026-01-10',
    siteId: '019b1c2e-0000-7000-8000-000000000001',
    rfc: 'GOMA850101AB1',
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
