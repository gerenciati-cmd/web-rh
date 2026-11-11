import { DEFAULT_LATENESS_RULE, type LatenessPeriod } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import {
  applyLatenessRule,
  latenessPeriodOf,
  latenessSegments,
  type LatenessRule,
} from './lateness-rule';
import type { ShiftId } from './shift';
import type { Workday } from './workday';

/**
 * Regla "N retardos = 1 falta" (plan attendance-asistencia-diaria/004, decisiones 26-30). Todo es
 * aritmética de calendario sobre fechas `YYYY-MM-DD`: no hay reloj ni zona. En 2026-11-09 es lunes.
 */
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const SET_AT = new Date('2026-10-01T12:00:00Z');

function rule(effectiveFrom: string, threshold: number, period: LatenessPeriod): LatenessRule {
  return { companyId: COMPANY, effectiveFrom, threshold, period, setAt: SET_AT, setBy: USER };
}

describe('latenessPeriodOf', () => {
  describe('WEEK: lunes a domingo', () => {
    it.each([
      ['un miércoles', '2026-11-11', '2026-11-09', '2026-11-15'],
      ['el propio lunes', '2026-11-09', '2026-11-09', '2026-11-15'],
      ['el domingo pertenece a la semana que termina', '2026-11-15', '2026-11-09', '2026-11-15'],
      ['el lunes siguiente abre otra semana', '2026-11-16', '2026-11-16', '2026-11-22'],
      ['una semana que cruza de mes', '2026-12-01', '2026-11-30', '2026-12-06'],
      ['una semana que cruza de año', '2027-01-01', '2026-12-28', '2027-01-03'],
    ])('%s', (_name, date, start, end) => {
      expect(latenessPeriodOf(date, 'WEEK')).toEqual({ start, end });
    });
  });

  describe('FORTNIGHT: 1-15 y 16 a fin de mes', () => {
    it.each([
      ['día 1', '2026-11-01', '2026-11-01', '2026-11-15'],
      ['día 15, último de la primera quincena', '2026-11-15', '2026-11-01', '2026-11-15'],
      ['día 16, primero de la segunda', '2026-11-16', '2026-11-16', '2026-11-30'],
      ['mes de 30 días', '2026-11-20', '2026-11-16', '2026-11-30'],
      ['mes de 31 días', '2026-12-31', '2026-12-16', '2026-12-31'],
      ['febrero de 28 días', '2026-02-20', '2026-02-16', '2026-02-28'],
      ['febrero bisiesto de 29 días', '2028-02-20', '2028-02-16', '2028-02-29'],
    ])('%s', (_name, date, start, end) => {
      expect(latenessPeriodOf(date, 'FORTNIGHT')).toEqual({ start, end });
    });
  });

  describe('MONTH: mes calendario', () => {
    it.each([
      ['mes de 30 días', '2026-11-10', '2026-11-01', '2026-11-30'],
      ['mes de 31 días', '2026-12-31', '2026-12-01', '2026-12-31'],
      ['febrero de 28 días', '2026-02-01', '2026-02-01', '2026-02-28'],
      ['febrero bisiesto de 29 días', '2028-02-29', '2028-02-01', '2028-02-29'],
    ])('%s', (_name, date, start, end) => {
      expect(latenessPeriodOf(date, 'MONTH')).toEqual({ start, end });
    });
  });
});

describe('latenessSegments', () => {
  it('sin reglas usa la regla por defecto: 3 por quincena', () => {
    const segments = latenessSegments([], '2026-11-10', '2026-11-20');

    expect(DEFAULT_LATENESS_RULE).toEqual({ threshold: 3, period: 'FORTNIGHT' });
    expect(segments).toEqual([
      { start: '2026-11-01', end: '2026-11-15', threshold: 3 },
      { start: '2026-11-16', end: '2026-11-30', threshold: 3 },
    ]);
  });

  it('devuelve el tramo completo, sin recortarlo al rango pedido', () => {
    expect(latenessSegments([], '2026-11-10', '2026-11-10')).toEqual([
      { start: '2026-11-01', end: '2026-11-15', threshold: 3 },
    ]);
  });

  it('cada tramo sale una sola vez aunque el rango tenga muchos días de él', () => {
    const segments = latenessSegments([], '2026-11-01', '2026-11-15');

    expect(segments).toHaveLength(1);
  });

  it('un rango de un día en el límite entre quincenas toca solo la que contiene el día', () => {
    expect(latenessSegments([], '2026-11-16', '2026-11-16')).toEqual([
      { start: '2026-11-16', end: '2026-11-30', threshold: 3 },
    ]);
  });

  it('una regla nueva corta el periodo anterior el día previo a su vigencia y el nuevo empieza en su vigencia', () => {
    const segments = latenessSegments([rule('2026-11-12', 2, 'WEEK')], '2026-11-10', '2026-11-12');

    // El lunes 2026-11-09 es anterior a la regla: su semana se recorta a empezar el 12.
    expect(segments).toEqual([
      { start: '2026-11-01', end: '2026-11-11', threshold: 3 },
      { start: '2026-11-12', end: '2026-11-15', threshold: 2 },
    ]);
  });

  it('con una regla vigente aplica su N y su periodo, sin recortar si no hay otra después', () => {
    const segments = latenessSegments([rule('2026-11-01', 5, 'MONTH')], '2026-11-10', '2026-11-10');

    expect(segments).toEqual([{ start: '2026-11-01', end: '2026-11-30', threshold: 5 }]);
  });

  it('con historial rige la última regla con effectiveFrom <= fecha, y la vigencia de cada una termina donde empieza la siguiente', () => {
    const history = [rule('2026-11-12', 2, 'MONTH'), rule('2026-12-01', 4, 'WEEK')];

    const segments = latenessSegments(history, '2026-11-10', '2026-12-02');

    expect(segments).toEqual([
      { start: '2026-11-01', end: '2026-11-11', threshold: 3 },
      { start: '2026-11-12', end: '2026-11-30', threshold: 2 },
      { start: '2026-12-01', end: '2026-12-06', threshold: 4 },
    ]);
  });

  it('el día exacto de effectiveFrom ya pertenece a la regla nueva (inclusive)', () => {
    const history = [rule('2026-11-12', 2, 'MONTH')];

    expect(latenessSegments(history, '2026-11-11', '2026-11-11')).toEqual([
      { start: '2026-11-01', end: '2026-11-11', threshold: 3 },
    ]);
    expect(latenessSegments(history, '2026-11-12', '2026-11-12')).toEqual([
      { start: '2026-11-12', end: '2026-11-30', threshold: 2 },
    ]);
  });

  it('los tramos salen ascendentes y sin repetir cuando un rango cruza dos reglas', () => {
    const history = [rule('2026-11-12', 2, 'WEEK'), rule('2026-11-23', 3, 'FORTNIGHT')];

    const segments = latenessSegments(history, '2026-11-01', '2026-11-30');

    expect(segments.map((segment) => `${segment.start}..${segment.end}`)).toEqual([
      '2026-11-01..2026-11-11',
      '2026-11-12..2026-11-15',
      '2026-11-16..2026-11-22',
      '2026-11-23..2026-11-30',
    ]);
  });
});

function workday(date: string, lateMinutes: number, overrides: Partial<Workday> = {}): Workday {
  return {
    employeeId: '00000000-0000-4000-8000-0000000000e1',
    companyId: COMPANY,
    date,
    shiftId: 'shift-1' as ShiftId,
    status: 'ATTENDED',
    scheduledStartAt: new Date(`${date}T14:00:00Z`),
    scheduledEndAt: new Date(`${date}T23:00:00Z`),
    scheduledMinutes: 480,
    firstPunchAt: new Date(`${date}T14:00:00Z`),
    lastPunchAt: new Date(`${date}T23:00:00Z`),
    punchCount: 2,
    lateMinutes,
    workedMinutes: 480,
    overtimeMinutes: 0,
    calculatedAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
  };
}

const NOW = new Date('2026-11-20T12:00:00Z');
const statusesOf = (list: Workday[]) => list.map((item) => [item.date, item.status]);

describe('applyLatenessRule', () => {
  it('N=1: cada retardo se vuelve falta por retardos y conserva sus minutos', () => {
    const result = applyLatenessRule(
      [workday('2026-11-02', 12), workday('2026-11-03', 0), workday('2026-11-04', 30)],
      1,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ABSENT_LATENESS'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ABSENT_LATENESS'],
    ]);
    expect(result.map((item) => item.lateMinutes)).toEqual([12, 0, 30]);
  });

  it('N=3 con 2 retardos: ninguno se vuelve falta', () => {
    const result = applyLatenessRule([workday('2026-11-02', 5), workday('2026-11-03', 6)], 3, NOW);

    expect(result.every((item) => item.status === 'ATTENDED')).toBe(true);
  });

  it('N=3 con 3 retardos: el tercero es la falta', () => {
    const result = applyLatenessRule(
      [workday('2026-11-02', 5), workday('2026-11-03', 6), workday('2026-11-04', 7)],
      3,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ABSENT_LATENESS'],
    ]);
  });

  it('N=3 con 7 retardos: faltan el 3.º y el 6.º y el 7.º no se arrastra', () => {
    const days = [2, 3, 4, 5, 6, 9, 10].map((day) =>
      workday(`2026-11-${String(day).padStart(2, '0')}`, 10),
    );

    const result = applyLatenessRule(days, 3, NOW);

    expect(
      result.filter((item) => item.status === 'ABSENT_LATENESS').map((item) => item.date),
    ).toEqual(['2026-11-04', '2026-11-09']);
    expect(result.at(-1)?.status).toBe('ATTENDED');
  });

  it('cuenta en orden de fecha aunque la entrada llegue desordenada, y devuelve el resultado ordenado', () => {
    const result = applyLatenessRule(
      [workday('2026-11-04', 7), workday('2026-11-02', 5), workday('2026-11-03', 6)],
      3,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ABSENT_LATENESS'],
    ]);
  });

  it('los días sin retardo no cuentan ni cambian', () => {
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 5),
        workday('2026-11-03', 0),
        workday('2026-11-04', 0),
        workday('2026-11-05', 6),
        workday('2026-11-06', 7),
      ],
      3,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ATTENDED'],
      ['2026-11-05', 'ATTENDED'],
      ['2026-11-06', 'ABSENT_LATENESS'],
    ]);
  });

  it('las faltas y los descansos trabajados no cuentan como retardo aunque tengan minutos de retardo', () => {
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 5),
        workday('2026-11-03', 40, { status: 'ABSENT_SINGLE_PUNCH' }),
        workday('2026-11-04', 40, { status: 'REST_WORKED' }),
        workday('2026-11-05', 40, { status: 'ABSENT_NO_PUNCHES' }),
        workday('2026-11-06', 6),
      ],
      2,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ABSENT_SINGLE_PUNCH'],
      ['2026-11-04', 'REST_WORKED'],
      ['2026-11-05', 'ABSENT_NO_PUNCHES'],
      ['2026-11-06', 'ABSENT_LATENESS'],
    ]);
  });

  it('una falta por retardos anterior se reinicia: vuelve a asistencia si ya no completa el bloque', () => {
    // El 1.er retardo desapareció (ahora llegó a tiempo): el 3.º ya no es el 3.º.
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 0),
        workday('2026-11-03', 6),
        workday('2026-11-04', 7, { status: 'ABSENT_LATENESS' }),
      ],
      3,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ATTENDED'],
    ]);
    expect(result[2]?.lateMinutes).toBe(7);
  });

  it('una falta por retardos que se conserva cuenta como retardo al recontar (no se pierde su lugar)', () => {
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 5),
        workday('2026-11-03', 6),
        workday('2026-11-04', 7, { status: 'ABSENT_LATENESS' }),
        workday('2026-11-05', 8),
      ],
      3,
      NOW,
    );

    expect(statusesOf(result)).toEqual([
      ['2026-11-02', 'ATTENDED'],
      ['2026-11-03', 'ATTENDED'],
      ['2026-11-04', 'ABSENT_LATENESS'],
      ['2026-11-05', 'ATTENDED'],
    ]);
  });

  it('calculatedAt cambia solo en los días cuyo estado cambió', () => {
    const original = new Date('2026-11-01T00:00:00Z');
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 5),
        workday('2026-11-03', 6),
        workday('2026-11-04', 7),
        // Sin retardo: no cuenta y su estado no cambia.
        workday('2026-11-05', 0),
      ],
      3,
      NOW,
    );

    expect(result.map((item) => item.calculatedAt)).toEqual([original, original, NOW, original]);
  });

  it('el día que vuelve de falta por retardos a asistencia también recibe calculatedAt nuevo', () => {
    const result = applyLatenessRule(
      [workday('2026-11-02', 5, { status: 'ABSENT_LATENESS' })],
      3,
      NOW,
    );

    expect(result[0]).toMatchObject({ status: 'ATTENDED', calculatedAt: NOW });
  });

  it('una falta por retardos que no cambia conserva su calculatedAt', () => {
    const original = new Date('2026-11-01T00:00:00Z');
    const result = applyLatenessRule(
      [
        workday('2026-11-02', 5),
        workday('2026-11-03', 6),
        workday('2026-11-04', 7, { status: 'ABSENT_LATENESS' }),
      ],
      3,
      NOW,
    );

    expect(result[2]).toMatchObject({ status: 'ABSENT_LATENESS', calculatedAt: original });
  });

  it('no muta la entrada: devuelve objetos nuevos', () => {
    const input = [
      Object.freeze(workday('2026-11-02', 5)),
      Object.freeze(workday('2026-11-03', 6)),
      Object.freeze(workday('2026-11-04', 7)),
    ];
    const snapshot = structuredClone(input);

    const result = applyLatenessRule(input, 3, NOW);

    expect(input).toEqual(snapshot);
    expect(result[2]).not.toBe(input[2]);
    expect(result[2]?.status).toBe('ABSENT_LATENESS');
    expect(input[2]?.status).toBe('ATTENDED');
  });

  it('una lista vacía devuelve una lista vacía', () => {
    expect(applyLatenessRule([], 3, NOW)).toEqual([]);
  });
});
