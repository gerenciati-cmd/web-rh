import { describe, expect, it } from 'vitest';

import {
  RecalculateWorkdaysSchema,
  WorkdayRangeSchema,
  WorkdayRecalculationSchema,
  WorkdaySchema,
  attendanceWorkdayRoutes,
} from './workday.contract';

function issues(input: unknown): { path: unknown[]; message: string }[] {
  const result = WorkdayRangeSchema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

describe('WorkdayRangeSchema', () => {
  it('acepta un rango de un solo día y uno ascendente', () => {
    expect(WorkdayRangeSchema.safeParse({ from: '2026-10-05', to: '2026-10-05' }).success).toBe(
      true,
    );
    expect(WorkdayRangeSchema.safeParse({ from: '2026-10-05', to: '2026-10-11' }).success).toBe(
      true,
    );
  });

  it('rechaza una fecha final anterior a la inicial, con el error en to', () => {
    expect(issues({ from: '2026-10-11', to: '2026-10-05' })).toEqual([
      { path: ['to'], message: 'La fecha final no puede ser anterior a la inicial' },
    ]);
  });

  it('acepta exactamente 62 días y rechaza 63, con el error en to', () => {
    // 2026-10-01 + 61 días = 2026-12-01 (62 días inclusive).
    expect(WorkdayRangeSchema.safeParse({ from: '2026-10-01', to: '2026-12-01' }).success).toBe(
      true,
    );
    expect(issues({ from: '2026-10-01', to: '2026-12-02' })).toEqual([
      { path: ['to'], message: 'El rango no puede pasar de 62 días' },
    ]);
  });

  it.each([
    ['fecha con formato inválido', { from: '05-10-2026', to: '2026-10-11' }],
    ['fecha de calendario inexistente', { from: '2026-02-30', to: '2026-03-02' }],
    ['falta from', { to: '2026-10-11' }],
    ['falta to', { from: '2026-10-05' }],
  ])('rechaza %s', (_name, input) => {
    expect(WorkdayRangeSchema.safeParse(input).success).toBe(false);
  });

  it('el cuerpo de recalculo usa el mismo rango', () => {
    expect(
      RecalculateWorkdaysSchema.safeParse({ from: '2026-10-11', to: '2026-10-05' }).success,
    ).toBe(false);
    expect(
      RecalculateWorkdaysSchema.safeParse({ from: '2026-10-05', to: '2026-10-11' }).success,
    ).toBe(true);
  });
});

describe('WorkdaySchema', () => {
  const valid = {
    date: '2026-10-05',
    shiftId: '00000000-0000-4000-8000-0000000000a1',
    shiftName: 'Oficina',
    status: 'ATTENDED',
    scheduledStartAt: '2026-10-05T14:00:00.000Z',
    scheduledEndAt: '2026-10-05T23:00:00.000Z',
    scheduledMinutes: 480,
    firstPunchAt: '2026-10-05T13:00:00.000Z',
    lastPunchAt: '2026-10-05T23:00:00.000Z',
    punchCount: 2,
    lateMinutes: 0,
    workedMinutes: 540,
    overtimeMinutes: 60,
    calculatedAt: '2026-12-01T12:00:00.000Z',
  };

  it('acepta una jornada completa', () => {
    expect(WorkdaySchema.parse(valid)).toEqual(valid);
  });

  it('acepta un descanso trabajado con horario programado nulo', () => {
    const rest = {
      ...valid,
      status: 'REST_WORKED',
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduledMinutes: 0,
    };

    expect(WorkdaySchema.safeParse(rest).success).toBe(true);
  });

  it('acepta una falta sin marcaciones con primera y última nulas', () => {
    const absent = {
      ...valid,
      status: 'ABSENT_NO_PUNCHES',
      firstPunchAt: null,
      lastPunchAt: null,
      punchCount: 0,
    };

    expect(WorkdaySchema.safeParse(absent).success).toBe(true);
  });

  it.each(['ATTENDED', 'ABSENT_NO_PUNCHES', 'ABSENT_SINGLE_PUNCH', 'REST_WORKED'])(
    'acepta el estado %s',
    (status) => {
      expect(WorkdaySchema.safeParse({ ...valid, status }).success).toBe(true);
    },
  );

  it.each([
    ['estado desconocido', { status: 'LATE' }],
    ['minutos negativos', { overtimeMinutes: -1 }],
    ['minutos con decimales', { workedMinutes: 1.5 }],
    ['marcaciones negativas', { punchCount: -1 }],
    ['shiftId que no es uuid', { shiftId: 'no-uuid' }],
    ['instante sin zona', { firstPunchAt: '2026-10-05T08:00:00' }],
  ])('rechaza %s', (_name, override) => {
    expect(WorkdaySchema.safeParse({ ...valid, ...override }).success).toBe(false);
  });
});

describe('WorkdayRecalculationSchema', () => {
  it('acepta el resumen con fechas pendientes', () => {
    const summary = {
      recalculatedDates: 6,
      storedWorkdays: 5,
      pendingDates: ['2026-10-11'],
    };

    expect(WorkdayRecalculationSchema.parse(summary)).toEqual(summary);
  });

  it('rechaza conteos negativos y pendientes que no son fechas', () => {
    expect(
      WorkdayRecalculationSchema.safeParse({
        recalculatedDates: -1,
        storedWorkdays: 0,
        pendingDates: [],
      }).success,
    ).toBe(false);
    expect(
      WorkdayRecalculationSchema.safeParse({
        recalculatedDates: 0,
        storedWorkdays: 0,
        pendingDates: ['ayer'],
      }).success,
    ).toBe(false);
  });
});

describe('attendanceWorkdayRoutes', () => {
  it('recalcular exige attendance.workdays:recalculate y leer attendance.workdays:read, por empresa', () => {
    expect(attendanceWorkdayRoutes.recalculateEmployeeWorkdays.access).toEqual({
      kind: 'permission',
      permission: 'attendance.workdays:recalculate',
      companyParam: 'companyId',
    });
    expect(attendanceWorkdayRoutes.listEmployeeWorkdays.access).toEqual({
      kind: 'permission',
      permission: 'attendance.workdays:read',
      companyParam: 'companyId',
    });
  });

  it('declara métodos, rutas y errores', () => {
    expect(attendanceWorkdayRoutes.recalculateEmployeeWorkdays).toMatchObject({
      method: 'POST',
      path: '/companies/:companyId/attendance/employees/:employeeId/workdays/recalculation',
    });
    expect(attendanceWorkdayRoutes.listEmployeeWorkdays).toMatchObject({
      method: 'GET',
      path: '/companies/:companyId/attendance/employees/:employeeId/workdays',
    });
    expect(attendanceWorkdayRoutes.recalculateEmployeeWorkdays.errors).toEqual([
      'EMPLOYEE_NOT_FOUND',
      'SITE_NOT_FOUND',
      'EMPLOYEE_WITHOUT_RFC',
      'EMPLOYEE_WITHOUT_SITE',
      { code: 'EMPLOYEE_INACTIVE', variant: 'employees' },
    ]);
    expect(attendanceWorkdayRoutes.listEmployeeWorkdays.errors).toEqual(['EMPLOYEE_NOT_FOUND']);
  });

  it('el recalculo responde con el resumen y la lista con items', () => {
    expect(attendanceWorkdayRoutes.recalculateEmployeeWorkdays.response).toBe(
      WorkdayRecalculationSchema,
    );
    expect(
      attendanceWorkdayRoutes.listEmployeeWorkdays.response.safeParse({ items: [] }).success,
    ).toBe(true);
  });

  it('la consulta valida el rango y los parámetros exigen uuid', () => {
    const { listEmployeeWorkdays } = attendanceWorkdayRoutes;

    expect(
      listEmployeeWorkdays.query.safeParse({ from: '2026-10-11', to: '2026-10-05' }).success,
    ).toBe(false);
    expect(listEmployeeWorkdays.params.safeParse({ companyId: 'x', employeeId: 'y' }).success).toBe(
      false,
    );
  });
});
