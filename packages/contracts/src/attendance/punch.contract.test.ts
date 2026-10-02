import { describe, expect, it } from 'vitest';

import { ListPunchesQuerySchema, PunchSchema, attendancePunchRoutes } from './punch.contract';

describe('ListPunchesQuerySchema', () => {
  it('aplica los defaults de paginación y los filtros son opcionales', () => {
    const parsed = ListPunchesQuerySchema.parse({});

    expect(parsed).toEqual({ page: 1, pageSize: 20 });
  });

  it('acepta todos los filtros y recorta el PIN', () => {
    const parsed = ListPunchesQuerySchema.parse({
      deviceId: '00000000-0000-4000-8000-000000000001',
      pin: ' 2 ',
      from: '2026-09-28T00:00:00.000Z',
      to: '2026-09-29T00:00:00.000Z',
    });

    expect(parsed.pin).toBe('2');
    expect(parsed.from).toBe('2026-09-28T00:00:00.000Z');
  });

  it('rechaza deviceId que no es uuid', () => {
    expect(ListPunchesQuerySchema.safeParse({ deviceId: 'abc' }).success).toBe(false);
  });

  it.each(['', '   ', 'x'.repeat(33)])('rechaza el pin %j', (pin) => {
    expect(ListPunchesQuerySchema.safeParse({ pin }).success).toBe(false);
  });

  it.each(['2026-09-28', 'ayer', '2026-09-28 10:00:00'])('rechaza from/to no ISO %j', (value) => {
    expect(ListPunchesQuerySchema.safeParse({ from: value }).success).toBe(false);
    expect(ListPunchesQuerySchema.safeParse({ to: value }).success).toBe(false);
  });
});

describe('PunchSchema.employee', () => {
  const punch = {
    id: '00000000-0000-4000-8000-000000000001',
    deviceId: '00000000-0000-4000-8000-000000000002',
    serialNumber: 'TESTSN001',
    pin: 'GOMA850101AB1',
    occurredAt: '2026-09-28T13:00:00.000Z',
    deviceLocalTime: '2026-09-28 08:00:00',
    status: '0',
    verifyMode: '1',
    receivedAt: '2026-09-29T00:00:00.000Z',
  };
  const employee = {
    id: '00000000-0000-4000-8000-000000000003',
    fullName: 'Ana Rojas',
    companyId: '00000000-0000-4000-8000-000000000004',
  };

  it('acepta el colaborador dueño de la marcación', () => {
    expect(PunchSchema.parse({ ...punch, employee }).employee).toEqual(employee);
  });

  it('acepta employee null (PIN sin colaborador)', () => {
    expect(PunchSchema.parse({ ...punch, employee: null }).employee).toBeNull();
  });

  it('el campo es obligatorio: sin employee se rechaza', () => {
    expect(PunchSchema.safeParse(punch).success).toBe(false);
  });

  it.each([
    ['id que no es uuid', { ...employee, id: 'no-uuid' }],
    ['companyId que no es uuid', { ...employee, companyId: 'no-uuid' }],
    ['sin fullName', { id: employee.id, companyId: employee.companyId }],
  ])('rechaza un employee con %s', (_name, bad) => {
    expect(PunchSchema.safeParse({ ...punch, employee: bad }).success).toBe(false);
  });
});

describe('attendancePunchRoutes', () => {
  it('listPunches: GET /attendance/punches con permiso sin empresa', () => {
    expect(attendancePunchRoutes.listPunches).toMatchObject({
      method: 'GET',
      path: '/attendance/punches',
      access: { kind: 'permission', permission: 'attendance.punches:read' },
    });
    expect(attendancePunchRoutes.listPunches.access).not.toHaveProperty('companyParam');
  });
});
