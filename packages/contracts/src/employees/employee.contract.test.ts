import { describe, expect, it } from 'vitest';

import {
  AssignEmployeeRfcSchema,
  AssignEmployeeSiteSchema,
  EmployeeListItemSchema,
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

describe('RegisterEmployeeSchema › sede', () => {
  const valid = {
    firstName: 'Ana',
    lastName: 'Rojas',
    email: 'ana@example.com',
    hireDate: '2026-01-10',
    nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
    rfc: 'GOMA850101AB1',
    siteId: '019b1c2e-0000-7000-8000-000000000001',
  };

  it('acepta un siteId uuid', () => {
    expect(RegisterEmployeeSchema.safeParse(valid).success).toBe(true);
  });

  it('rechaza la falta de siteId con el error en siteId', () => {
    const { siteId: _omitido, ...withoutSite } = valid;
    const result = RegisterEmployeeSchema.safeParse(withoutSite);
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['siteId']);
  });

  it('rechaza un siteId que no es uuid, con el error en siteId', () => {
    const result = RegisterEmployeeSchema.safeParse({ ...valid, siteId: 'sede-1' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['siteId']);
  });
});

describe('AssignEmployeeSiteSchema', () => {
  it('acepta un siteId uuid', () => {
    const siteId = '019b1c2e-0000-7000-8000-000000000001';
    const result = AssignEmployeeSiteSchema.safeParse({ siteId });
    expect(result.success && result.data.siteId).toBe(siteId);
  });

  it.each([[{}], [{ siteId: 'x' }], [{ siteId: '' }], [{ siteId: null }]])(
    'rechaza %j con el error en siteId',
    (body) => {
      const result = AssignEmployeeSiteSchema.safeParse(body);
      expect(result.success).toBe(false);
      expect(!result.success && result.error.issues[0]?.path).toEqual(['siteId']);
    },
  );
});

describe('employeeRoutes.assignEmployeeSite', () => {
  const route = employeeRoutes.assignEmployeeSite;

  it('es PUT /companies/:companyId/employees/:employeeId/site con 204', () => {
    expect(route.method).toBe('PUT');
    expect(route.path).toBe('/companies/:companyId/employees/:employeeId/site');
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
    expect(route.params.safeParse({ companyId: 'x', employeeId: uuid }).success).toBe(false);
  });
});

describe('EmployeeListItemSchema › siteId', () => {
  const item = {
    id: '00000000-0000-4000-8000-000000000001',
    fullName: 'Ana Rojas',
    nationalId: 'GOMA850101HQRRRN04',
    rfc: null,
    email: 'ana@example.com',
    positionTitle: null,
    hireDate: '2026-01-10',
    status: 'ACTIVE',
  };

  it('acepta siteId null (fila anterior al campo) y uuid', () => {
    expect(EmployeeListItemSchema.safeParse({ ...item, siteId: null }).success).toBe(true);
    expect(
      EmployeeListItemSchema.safeParse({
        ...item,
        siteId: '019b1c2e-0000-7000-8000-000000000001',
      }).success,
    ).toBe(true);
  });

  it('exige el campo siteId (nullable, no opcional)', () => {
    expect(EmployeeListItemSchema.safeParse(item).success).toBe(false);
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
