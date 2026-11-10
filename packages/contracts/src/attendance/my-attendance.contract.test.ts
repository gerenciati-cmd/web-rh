import { describe, expect, it } from 'vitest';

import { API_ERRORS, errorRefCode } from '../errors';

import { MyTodaySchema, MyWorkdaysQuerySchema, myAttendanceRoutes } from './my-attendance.contract';

const WORK_DAY = {
  type: 'WORK',
  scheduledStartAt: '2026-11-10T14:00:00.000Z',
  scheduledEndAt: '2026-11-10T23:00:00.000Z',
  scheduledMinutes: 480,
  mealBreakMinutes: 60,
  toleranceMinutes: 10,
} as const;
const SHIFT_ID = '00000000-0000-4000-8000-0000000000a1';

function today(shift: unknown, punches: unknown = []) {
  return { date: '2026-11-10', timeZone: 'America/Cancun', shift, punches };
}

describe('MyWorkdaysQuerySchema', () => {
  it.each(['2026-01', '2026-09', '2026-10', '2026-12'])('acepta %s', (month) => {
    expect(MyWorkdaysQuerySchema.safeParse({ month }).success).toBe(true);
  });

  it.each([
    ['mes 13', '2026-13'],
    ['mes 00', '2026-00'],
    ['mes sin cero a la izquierda', '2026-1'],
    ['con día', '2026-11-01'],
    ['sin guion', '202611'],
    ['año de dos dígitos', '26-11'],
    ['vacío', ''],
    ['texto', 'noviembre'],
  ])('rechaza %s', (_name, month) => {
    expect(MyWorkdaysQuerySchema.safeParse({ month }).success).toBe(false);
  });

  it('rechaza si falta month', () => {
    expect(MyWorkdaysQuerySchema.safeParse({}).success).toBe(false);
  });
});

describe('MyTodaySchema', () => {
  it('acepta un día laborable con sus instantes y minutos', () => {
    const body = today({ id: SHIFT_ID, name: 'Oficina', day: WORK_DAY }, [
      '2026-11-10T13:56:00.000Z',
    ]);

    expect(MyTodaySchema.safeParse(body).success).toBe(true);
  });

  it('acepta un día de descanso, que no lleva campos de horario', () => {
    expect(
      MyTodaySchema.safeParse(today({ id: SHIFT_ID, name: 'Oficina', day: { type: 'REST' } }))
        .success,
    ).toBe(true);
  });

  it('acepta shift null (sin turno o fuera de la contratación)', () => {
    expect(MyTodaySchema.safeParse(today(null)).success).toBe(true);
  });

  it('el día laborable sin horario programado se rechaza (unión discriminada por type)', () => {
    const { scheduledStartAt: _omitted, ...incomplete } = WORK_DAY;

    expect(
      MyTodaySchema.safeParse(today({ id: SHIFT_ID, name: 'Oficina', day: incomplete })).success,
    ).toBe(false);
  });

  it('rechaza un type de día desconocido', () => {
    expect(
      MyTodaySchema.safeParse(today({ id: SHIFT_ID, name: 'Oficina', day: { type: 'HOLIDAY' } }))
        .success,
    ).toBe(false);
  });

  it('rechaza marcaciones que no son instantes ISO y un id de turno que no es uuid', () => {
    expect(MyTodaySchema.safeParse(today(null, ['2026-11-10 08:56:00'])).success).toBe(false);
    expect(
      MyTodaySchema.safeParse(today({ id: 'no-uuid', name: 'Oficina', day: { type: 'REST' } }))
        .success,
    ).toBe(false);
  });
});

describe('myAttendanceRoutes', () => {
  it('ambas rutas piden el permiso read-own y no reciben ningún id de colaborador', () => {
    for (const route of Object.values(myAttendanceRoutes)) {
      expect(route.path.startsWith('/me/attendance/')).toBe(true);
      expect(route.path).not.toMatch(/:/);
      expect(route.access).toEqual({
        kind: 'permission',
        permission: 'attendance.workdays:read-own',
      });
    }
  });

  it('solo listMyWorkdays declara MONTH_NOT_AVAILABLE', () => {
    expect(myAttendanceRoutes.listMyWorkdays.errors).toContain('MONTH_NOT_AVAILABLE');
    expect(myAttendanceRoutes.getMyAttendanceToday.errors).not.toContain('MONTH_NOT_AVAILABLE');
  });

  it('todo código de error declarado por las rutas existe en el catálogo', () => {
    for (const route of Object.values(myAttendanceRoutes)) {
      for (const ref of route.errors) {
        expect(API_ERRORS).toHaveProperty(errorRefCode(ref));
      }
    }
  });
});

describe('catálogo de errores de mis jornadas', () => {
  it('ACCOUNT_NOT_LINKED y MONTH_NOT_AVAILABLE son 422 con un ejemplo cuyo code coincide', () => {
    for (const code of ['ACCOUNT_NOT_LINKED', 'MONTH_NOT_AVAILABLE'] as const) {
      expect(API_ERRORS[code].status).toBe(422);
      expect(API_ERRORS[code].examples.default.code).toBe(code);
    }
  });

  it('MONTH_NOT_AVAILABLE documenta el mes en los detalles', () => {
    expect(API_ERRORS.MONTH_NOT_AVAILABLE.examples.default.details).toEqual({ month: '2026-01' });
  });
});
