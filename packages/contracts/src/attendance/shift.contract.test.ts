import { describe, expect, it } from 'vitest';

import {
  AssignShiftSchema,
  CreateShiftSchema,
  ShiftSchema,
  attendanceShiftRoutes,
} from './shift.contract';

const WORK = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 } as const;
const valid = {
  name: 'Oficina',
  cycleStartDate: '2026-11-02',
  toleranceMinutes: 10,
  days: [WORK, { type: 'REST' }],
};

function issuePaths(input: unknown): unknown[][] {
  const result = CreateShiftSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
}

describe('CreateShiftSchema', () => {
  it('acepta un turno válido y recorta el nombre', () => {
    const parsed = CreateShiftSchema.parse({ ...valid, name: '  Oficina ' });

    expect(parsed).toEqual(valid);
  });

  it('la comida por omisión es 0 en un día laborable', () => {
    const parsed = CreateShiftSchema.parse({
      ...valid,
      days: [{ type: 'WORK', start: '09:00', end: '14:00' }],
    });

    expect(parsed.days[0]).toEqual({
      type: 'WORK',
      start: '09:00',
      end: '14:00',
      mealBreakMinutes: 0,
    });
  });

  it('acepta un turno nocturno y uno de 24x24', () => {
    const night = { type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 30 };
    const day24 = { type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 0 };

    expect(CreateShiftSchema.safeParse({ ...valid, days: [night] }).success).toBe(true);
    expect(CreateShiftSchema.safeParse({ ...valid, days: [day24, { type: 'REST' }] }).success).toBe(
      true,
    );
  });

  it('rechaza un ciclo solo de descansos, con el error en days', () => {
    const result = CreateShiftSchema.safeParse({ ...valid, days: [{ type: 'REST' }] });

    expect(!result.success && result.error.issues[0]?.path).toEqual(['days']);
    expect(!result.success && result.error.issues[0]?.message).toBe(
      'El turno necesita al menos un día laborable',
    );
  });

  it('rechaza 0 y 29 días', () => {
    // Vacío incumple el mínimo y además no tiene día laborable: dos issues, ambos en days.
    expect(new Set(issuePaths({ ...valid, days: [] }).map(String))).toEqual(new Set(['days']));
    const tooLong = [WORK, ...Array.from({ length: 28 }, () => ({ type: 'REST' }))];
    expect(issuePaths({ ...valid, days: tooLong })).toEqual([['days']]);
  });

  it('acepta 28 días', () => {
    const days = [WORK, ...Array.from({ length: 27 }, () => ({ type: 'REST' }))];

    expect(CreateShiftSchema.safeParse({ ...valid, days }).success).toBe(true);
  });

  it('rechaza una comida igual a la jornada, con la ruta del día', () => {
    const days = [{ type: 'WORK', start: '09:00', end: '10:00', mealBreakMinutes: 60 }];

    expect(issuePaths({ ...valid, days })).toEqual([['days', 0, 'mealBreakMinutes']]);
  });

  it('rechaza una comida mayor a la jornada nocturna y acepta una menor', () => {
    const longMeal = [{ type: 'WORK', start: '23:00', end: '00:30', mealBreakMinutes: 90 }];
    const okMeal = [{ type: 'WORK', start: '23:00', end: '00:30', mealBreakMinutes: 89 }];

    expect(issuePaths({ ...valid, days: longMeal })).toEqual([['days', 0, 'mealBreakMinutes']]);
    expect(CreateShiftSchema.safeParse({ ...valid, days: okMeal }).success).toBe(true);
  });

  it('con 24x24 la comida se compara contra 1440 minutos', () => {
    const days = [{ type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 120 }];

    expect(CreateShiftSchema.safeParse({ ...valid, days }).success).toBe(true);
  });

  it.each(['24:00', '9:00', '09:60', '', '09:00:00'])('rechaza la hora %j', (time) => {
    const days = [{ ...WORK, start: time }];

    expect(issuePaths({ ...valid, days })).toEqual([['days', 0, 'start']]);
  });

  it.each([-1, 121, 1.5])('rechaza la comida de %s minutos', (mealBreakMinutes) => {
    const days = [{ ...WORK, mealBreakMinutes }];

    expect(issuePaths({ ...valid, days })[0]).toEqual(['days', 0, 'mealBreakMinutes']);
  });

  it.each([-1, 61, 2.5])('rechaza la tolerancia %s', (toleranceMinutes) => {
    expect(issuePaths({ ...valid, toleranceMinutes })).toEqual([['toleranceMinutes']]);
  });

  it.each([0, 60])('acepta la tolerancia %s', (toleranceMinutes) => {
    expect(CreateShiftSchema.safeParse({ ...valid, toleranceMinutes }).success).toBe(true);
  });

  it.each(['', '   ', 'x'.repeat(101)])('rechaza el nombre %j', (name) => {
    expect(issuePaths({ ...valid, name })).toEqual([['name']]);
  });

  it.each(['2026-02-30', '02/11/2026', '2026-11-02T00:00:00Z'])(
    'rechaza cycleStartDate %j',
    (cycleStartDate) => {
      expect(issuePaths({ ...valid, cycleStartDate })).toEqual([['cycleStartDate']]);
    },
  );

  it('rechaza un tipo de día desconocido', () => {
    expect(CreateShiftSchema.safeParse({ ...valid, days: [{ type: 'HOLIDAY' }] }).success).toBe(
      false,
    );
  });
});

describe('ShiftSchema y AssignShiftSchema', () => {
  it('la lectura exige la comida en los días laborables', () => {
    const shift = {
      id: '00000000-0000-4000-8000-0000000000a1',
      name: 'Oficina',
      cycleStartDate: '2026-11-02',
      toleranceMinutes: 0,
      days: [{ type: 'WORK', start: '09:00', end: '18:00' }],
      active: true,
      createdAt: '2026-10-14T12:00:00.000Z',
    };

    expect(ShiftSchema.safeParse(shift).success).toBe(false);
    expect(
      ShiftSchema.safeParse({
        ...shift,
        days: [{ type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 0 }],
      }).success,
    ).toBe(true);
  });

  it('AssignShiftSchema exige un uuid', () => {
    expect(AssignShiftSchema.safeParse({ shiftId: 'no-uuid' }).success).toBe(false);
    expect(
      AssignShiftSchema.safeParse({ shiftId: '00000000-0000-4000-8000-0000000000a1' }).success,
    ).toBe(true);
  });
});

describe('attendanceShiftRoutes', () => {
  it('lectura con attendance.shifts:read y escritura con attendance.shifts:manage, por empresa', () => {
    const { listShifts, createShift, assignEmployeeShift, listEmployeeShiftAssignments } =
      attendanceShiftRoutes;

    expect(listShifts.access).toEqual({
      kind: 'permission',
      permission: 'attendance.shifts:read',
      companyParam: 'companyId',
    });
    expect(listEmployeeShiftAssignments.access).toEqual({
      kind: 'permission',
      companyParam: 'companyId',
      permission: 'attendance.shifts:read',
    });
    expect(createShift.access).toEqual({
      kind: 'permission',
      permission: 'attendance.shifts:manage',
      companyParam: 'companyId',
    });
    expect(assignEmployeeShift.access).toEqual({
      kind: 'permission',
      permission: 'attendance.shifts:manage',
      companyParam: 'companyId',
    });
  });

  it('declara métodos, estados de éxito y errores', () => {
    expect(attendanceShiftRoutes.createShift).toMatchObject({ method: 'POST', successStatus: 201 });
    expect(attendanceShiftRoutes.assignEmployeeShift).toMatchObject({
      method: 'PUT',
      successStatus: 204,
    });
    expect(attendanceShiftRoutes.createShift.errors).toEqual([
      'COMPANY_NOT_FOUND',
      'SHIFT_ALREADY_EXISTS',
    ]);
    expect(attendanceShiftRoutes.assignEmployeeShift.errors).toEqual([
      'EMPLOYEE_NOT_FOUND',
      'SHIFT_NOT_FOUND',
      { code: 'EMPLOYEE_INACTIVE', variant: 'employees' },
    ]);
    expect(attendanceShiftRoutes.listEmployeeShiftAssignments.errors).toEqual([
      'EMPLOYEE_NOT_FOUND',
    ]);
  });
});
