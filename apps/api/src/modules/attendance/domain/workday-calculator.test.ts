import { describe, expect, it } from 'vitest';

import type { ShiftDay, ShiftId } from './shift';
import { calculateWorkdays, windowBoundaries, type PlannedDate } from './workday-calculator';

/**
 * Calculadora de jornadas (plan attendance-asistencia-diaria/002). Todo en `America/Cancun`
 * (UTC−5 fijo, sin horario de verano), así que la hora local + 5 h = UTC y no hay saltos de reloj.
 */
const TZ = 'America/Cancun';
const SHIFT = 'shift-1' as ShiftId;
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const FAR_FUTURE = new Date('2026-12-01T00:00:00Z');

const OFFICE: ShiftDay = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const NIGHT: ShiftDay = { type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 30 };
const REST: ShiftDay = { type: 'REST' };

/** Instante UTC de la hora local de Cancún (`HH:mm` o `HH:mm:ss`). */
function at(date: string, time: string): Date {
  const full = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${full}-05:00`);
}

function plan(day: ShiftDay, toleranceMinutes = 10): PlannedDate['plan'] {
  return { shiftId: SHIFT, day, toleranceMinutes };
}

function addDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Lunes a viernes de oficina, fin de semana de descanso. */
function officeWeek(date: string): PlannedDate['plan'] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return plan(weekday === 0 || weekday === 6 ? REST : OFFICE);
}

function calendar(
  first: string,
  count: number,
  planOf: (date: string) => PlannedDate['plan'],
): PlannedDate[] {
  return Array.from({ length: count }, (_, index) => {
    const date = addDay(first, index);
    return { date, plan: planOf(date) };
  });
}

interface RunOptions {
  punches?: Date[];
  now?: Date;
  employedFrom?: string;
  employedUntil?: string | null;
  planOf?: (date: string) => PlannedDate['plan'];
  first?: string;
  count?: number;
}

/** Semana del lunes 2026-10-05 al domingo 2026-10-11, con un día de margen a cada lado. */
function run(options: RunOptions = {}) {
  return calculateWorkdays({
    employeeId: EMPLOYEE,
    companyId: COMPANY,
    calendar: calendar(
      options.first ?? '2026-10-04',
      options.count ?? 9,
      options.planOf ?? officeWeek,
    ),
    timeZone: TZ,
    punches: options.punches ?? [],
    employedFrom: options.employedFrom ?? '2026-01-01',
    employedUntil: options.employedUntil ?? null,
    now: options.now ?? FAR_FUTURE,
  });
}

function rowOf(result: ReturnType<typeof run>, date: string) {
  return result.workdays.find((workday) => workday.date === date);
}

describe('windowBoundaries', () => {
  function boundariesOf(entries: PlannedDate[]): string[] {
    return windowBoundaries(entries, TZ).map((boundary) => boundary.toISOString());
  }
  const iso = (date: string, time: string) => at(date, time).toISOString();

  it('días laborables consecutivos de 09:00 a 18:00: la ventana empieza 4 h antes de la entrada', () => {
    const entries = calendar('2026-10-05', 2, () => plan(OFFICE));

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '05:00'), iso('2026-10-06', '05:00')]);
  });

  it('descanso después de un día laborable: la ventana del descanso empieza 24 h − 4 h después de la entrada previa', () => {
    const entries = calendar('2026-10-09', 2, (date) =>
      plan(date === '2026-10-09' ? OFFICE : REST),
    );

    expect(boundariesOf(entries)).toEqual([iso('2026-10-09', '05:00'), iso('2026-10-10', '05:00')]);
  });

  it('turno nocturno seguido de otro: capta de 18:00 de D a 18:00 de D+1', () => {
    const entries = calendar('2026-10-05', 2, () => plan(NIGHT));

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '18:00'), iso('2026-10-06', '18:00')]);
  });

  it('descanso después de un turno nocturno: la salida se queda con su día hasta las 18:00', () => {
    const entries = calendar('2026-10-05', 3, (date) => plan(date === '2026-10-06' ? REST : NIGHT));

    expect(boundariesOf(entries)).toEqual([
      iso('2026-10-05', '18:00'),
      iso('2026-10-06', '18:00'),
      iso('2026-10-07', '18:00'),
    ]);
  });

  it('24x24: el día de descanso empieza 4 h después de la salida y el siguiente turno 4 h antes de la entrada', () => {
    const day24: ShiftDay = { type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 0 };
    const entries = calendar('2026-10-05', 3, (date) => plan(date === '2026-10-06' ? REST : day24));

    expect(boundariesOf(entries)).toEqual([
      iso('2026-10-05', '04:00'),
      iso('2026-10-06', '12:00'),
      iso('2026-10-07', '04:00'),
    ]);
  });

  it('turnos de 24 h pegados (la salida iguala la siguiente entrada): la frontera es la entrada', () => {
    const day24: ShiftDay = { type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 0 };
    const entries = calendar('2026-10-05', 2, () => plan(day24));

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '04:00'), iso('2026-10-06', '08:00')]);
  });

  it('turnos que se traslapan sin llegar a la entrada siguiente: la frontera es el punto medio', () => {
    const morning: ShiftDay = { type: 'WORK', start: '08:00', end: '16:00', mealBreakMinutes: 0 };
    // Sale a las 06:00 de D+1 y la siguiente entrada es a las 08:00: el medio es 07:00.
    const entries = [
      { date: '2026-10-05', plan: plan(NIGHT) },
      { date: '2026-10-06', plan: plan(morning) },
    ];

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '18:00'), iso('2026-10-06', '07:00')]);
  });

  it('turnos que se traslapan y la salida pasa de la siguiente entrada: la frontera es la entrada', () => {
    const longNight: ShiftDay = { type: 'WORK', start: '22:00', end: '10:00', mealBreakMinutes: 0 };
    const morning: ShiftDay = { type: 'WORK', start: '08:00', end: '16:00', mealBreakMinutes: 0 };
    const entries = [
      { date: '2026-10-05', plan: plan(longNight) },
      { date: '2026-10-06', plan: plan(morning) },
    ];

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '18:00'), iso('2026-10-06', '08:00')]);
  });

  it('las fronteras nunca decrecen: una entrada temprana tras un descanso largo no retrocede', () => {
    const day24: ShiftDay = { type: 'WORK', start: '20:00', end: '20:00', mealBreakMinutes: 0 };
    const early: ShiftDay = { type: 'WORK', start: '02:00', end: '10:00', mealBreakMinutes: 0 };
    const entries = [
      { date: '2026-10-05', plan: plan(day24) },
      { date: '2026-10-06', plan: plan(REST) },
      { date: '2026-10-07', plan: plan(early) },
    ];

    // D+2 por sí sola empezaría a las 22:00 de D+1, antes que la frontera del descanso (00:00 de D+2).
    expect(boundariesOf(entries)).toEqual([
      iso('2026-10-05', '16:00'),
      iso('2026-10-07', '00:00'),
      iso('2026-10-07', '00:00'),
    ]);
  });

  it('días sin turno asignado empiezan a medianoche', () => {
    const entries = [
      { date: '2026-10-05', plan: null },
      { date: '2026-10-06', plan: null },
    ];

    expect(boundariesOf(entries)).toEqual([iso('2026-10-05', '00:00'), iso('2026-10-06', '00:00')]);
  });

  it('devuelve una frontera por cada fecha del calendario', () => {
    expect(windowBoundaries(calendar('2026-10-04', 9, officeWeek), TZ)).toHaveLength(9);
  });
});

describe('calculateWorkdays', () => {
  describe('día laborable con entrada y salida (ATTENDED)', () => {
    it('llegada anticipada: lo trabajado resta la comida y la hora extra cuenta desde la entrada real', () => {
      const result = run({ punches: [at('2026-10-05', '08:00'), at('2026-10-05', '18:00')] });

      expect(rowOf(result, '2026-10-05')).toEqual({
        employeeId: EMPLOYEE,
        companyId: COMPANY,
        date: '2026-10-05',
        shiftId: SHIFT,
        status: 'ATTENDED',
        scheduledStartAt: at('2026-10-05', '09:00'),
        scheduledEndAt: at('2026-10-05', '18:00'),
        scheduledMinutes: 480,
        firstPunchAt: at('2026-10-05', '08:00'),
        lastPunchAt: at('2026-10-05', '18:00'),
        punchCount: 2,
        lateMinutes: 0,
        workedMinutes: 540,
        overtimeMinutes: 60,
        calculatedAt: FAR_FUTURE,
      });
    });

    it('retardo que pasa de la tolerancia: se cuenta completo desde la entrada programada', () => {
      const result = run({ punches: [at('2026-10-06', '09:15'), at('2026-10-06', '18:00')] });

      expect(rowOf(result, '2026-10-06')).toMatchObject({
        status: 'ATTENDED',
        lateMinutes: 15,
        workedMinutes: 465,
        overtimeMinutes: 0,
      });
    });

    it.each([
      ['09:09', 0],
      ['09:10', 0],
      ['09:10:59', 0],
      ['09:11', 11],
    ])(
      'entrada a las %s con tolerancia 10: retardo %i (igual a la tolerancia no es retardo)',
      (time, late) => {
        const result = run({ punches: [at('2026-10-07', time), at('2026-10-07', '18:00')] });

        expect(rowOf(result, '2026-10-07')?.lateMinutes).toBe(late);
      },
    );

    it('con tolerancia 0 cualquier minuto completo de retraso es retardo', () => {
      const result = run({
        planOf: () => plan(OFFICE, 0),
        punches: [at('2026-10-07', '09:01'), at('2026-10-07', '18:00')],
      });

      expect(rowOf(result, '2026-10-07')?.lateMinutes).toBe(1);
    });

    it('dentro de la tolerancia no hay retardo pero lo trabajado sí parte de la entrada real', () => {
      const result = run({ punches: [at('2026-10-07', '09:10'), at('2026-10-07', '18:00')] });

      expect(rowOf(result, '2026-10-07')).toMatchObject({ lateMinutes: 0, workedMinutes: 470 });
    });

    it('los minutos se truncan: los segundos sueltos no suman', () => {
      const result = run({
        punches: [at('2026-10-05', '09:00:30'), at('2026-10-05', '18:00:10')],
      });

      // 8 h 59 min 40 s → 539 min, menos 60 de comida.
      expect(rowOf(result, '2026-10-05')).toMatchObject({ lateMinutes: 0, workedMinutes: 479 });
    });

    it('lo trabajado nunca es negativo cuando la estancia es menor que la comida', () => {
      const result = run({ punches: [at('2026-10-05', '09:00'), at('2026-10-05', '09:30')] });

      expect(rowOf(result, '2026-10-05')).toMatchObject({
        status: 'ATTENDED',
        workedMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('salir tarde genera horas extra por encima de la jornada', () => {
      const result = run({ punches: [at('2026-10-05', '09:00'), at('2026-10-05', '20:00')] });

      expect(rowOf(result, '2026-10-05')).toMatchObject({
        workedMinutes: 600,
        overtimeMinutes: 120,
      });
    });

    it('con más de dos marcaciones la primera es la entrada y la última la salida', () => {
      const result = run({
        punches: [
          at('2026-10-05', '09:00'),
          at('2026-10-05', '13:00'),
          at('2026-10-05', '14:00'),
          at('2026-10-05', '18:00'),
        ],
      });

      expect(rowOf(result, '2026-10-05')).toMatchObject({
        punchCount: 4,
        firstPunchAt: at('2026-10-05', '09:00'),
        lastPunchAt: at('2026-10-05', '18:00'),
      });
    });

    it('las marcaciones desordenadas se ordenan antes de elegir entrada y salida', () => {
      const result = run({ punches: [at('2026-10-05', '18:00'), at('2026-10-05', '09:00')] });

      expect(rowOf(result, '2026-10-05')).toMatchObject({
        firstPunchAt: at('2026-10-05', '09:00'),
        lastPunchAt: at('2026-10-05', '18:00'),
      });
    });
  });

  describe('faltas', () => {
    it('sin marcaciones: ABSENT_NO_PUNCHES con la jornada programada y todo en cero', () => {
      const result = run();

      expect(rowOf(result, '2026-10-09')).toMatchObject({
        status: 'ABSENT_NO_PUNCHES',
        scheduledStartAt: at('2026-10-09', '09:00'),
        scheduledEndAt: at('2026-10-09', '18:00'),
        scheduledMinutes: 480,
        firstPunchAt: null,
        lastPunchAt: null,
        punchCount: 0,
        lateMinutes: 0,
        workedMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('con una sola marcación: ABSENT_SINGLE_PUNCH que guarda esa marcación como primera y última', () => {
      const result = run({ punches: [at('2026-10-08', '09:00')] });

      expect(rowOf(result, '2026-10-08')).toMatchObject({
        status: 'ABSENT_SINGLE_PUNCH',
        punchCount: 1,
        firstPunchAt: at('2026-10-08', '09:00'),
        lastPunchAt: at('2026-10-08', '09:00'),
        lateMinutes: 0,
        workedMinutes: 0,
        overtimeMinutes: 0,
        scheduledMinutes: 480,
      });
    });
  });

  describe('descanso trabajado', () => {
    it('dos marcaciones en descanso: REST_WORKED, todo lo trabajado es hora extra y no hay horario programado', () => {
      const result = run({ punches: [at('2026-10-10', '10:00'), at('2026-10-10', '12:00')] });

      expect(rowOf(result, '2026-10-10')).toEqual({
        employeeId: EMPLOYEE,
        companyId: COMPANY,
        date: '2026-10-10',
        shiftId: SHIFT,
        status: 'REST_WORKED',
        scheduledStartAt: null,
        scheduledEndAt: null,
        scheduledMinutes: 0,
        firstPunchAt: at('2026-10-10', '10:00'),
        lastPunchAt: at('2026-10-10', '12:00'),
        punchCount: 2,
        lateMinutes: 0,
        workedMinutes: 120,
        overtimeMinutes: 120,
        calculatedAt: FAR_FUTURE,
      });
    });

    it('con una sola marcación: REST_WORKED con 0 trabajado y 0 de hora extra', () => {
      const result = run({ punches: [at('2026-10-10', '10:00')] });

      expect(rowOf(result, '2026-10-10')).toMatchObject({
        status: 'REST_WORKED',
        punchCount: 1,
        workedMinutes: 0,
        overtimeMinutes: 0,
      });
    });

    it('no descuenta comida: lo trabajado es salida − entrada', () => {
      const result = run({ punches: [at('2026-10-10', '08:00'), at('2026-10-10', '09:30')] });

      expect(rowOf(result, '2026-10-10')).toMatchObject({ workedMinutes: 90, overtimeMinutes: 90 });
    });

    it('descanso sin marcaciones: no hay jornada pero la fecha queda cerrada', () => {
      const result = run();

      expect(rowOf(result, '2026-10-11')).toBeUndefined();
      expect(result.closedDates).toContain('2026-10-11');
    });

    it('la ventana del descanso llega hasta 4 h antes de la siguiente entrada', () => {
      // Domingo 22:00 a lunes 04:59 caen en la ventana del domingo (la del lunes empieza a las 05:00).
      const result = run({
        punches: [at('2026-10-11', '22:00'), at('2026-10-12', '04:59')],
      });

      expect(rowOf(result, '2026-10-11')).toMatchObject({
        status: 'REST_WORKED',
        workedMinutes: 419,
        punchCount: 2,
      });
    });
  });

  describe('ventana de marcaciones', () => {
    it('una marcación a las 04:59 pertenece al día anterior y a las 05:00 al día que empieza', () => {
      const result = run({
        punches: [at('2026-10-05', '09:00'), at('2026-10-06', '04:59'), at('2026-10-06', '05:00')],
      });

      expect(rowOf(result, '2026-10-05')).toMatchObject({
        status: 'ATTENDED',
        punchCount: 2,
        lastPunchAt: at('2026-10-06', '04:59'),
      });
      expect(rowOf(result, '2026-10-06')).toMatchObject({
        status: 'ABSENT_SINGLE_PUNCH',
        punchCount: 1,
        firstPunchAt: at('2026-10-06', '05:00'),
      });
    });

    it('marcaciones fuera de todas las fechas pedidas no producen jornada', () => {
      const result = run({ punches: [at('2026-09-01', '09:00'), at('2026-09-01', '18:00')] });

      expect(result.workdays.every((workday) => workday.punchCount === 0)).toBe(true);
    });
  });

  describe('turno nocturno', () => {
    const nightPlan = (date: string) => plan(date === '2026-10-05' ? NIGHT : REST);

    it('entra a las 21:50 de D y sale a las 06:05 de D+1: una sola jornada en D', () => {
      const result = run({
        first: '2026-10-04',
        count: 4,
        planOf: nightPlan,
        punches: [at('2026-10-05', '21:50'), at('2026-10-06', '06:05')],
      });

      expect(result.workdays).toHaveLength(1);
      expect(rowOf(result, '2026-10-05')).toMatchObject({
        status: 'ATTENDED',
        scheduledStartAt: at('2026-10-05', '22:00'),
        scheduledEndAt: at('2026-10-06', '06:00'),
        scheduledMinutes: 450,
        workedMinutes: 465,
        overtimeMinutes: 15,
        lateMinutes: 0,
      });
      expect(rowOf(result, '2026-10-06')).toBeUndefined();
      expect(result.closedDates).toEqual(['2026-10-05', '2026-10-06']);
    });
  });

  describe('fechas sin jornada', () => {
    it('un día sin turno asignado no genera jornada aunque haya marcaciones, pero queda cerrado', () => {
      const result = run({
        planOf: (date) => (date === '2026-10-07' ? null : officeWeek(date)),
        punches: [at('2026-10-07', '10:00'), at('2026-10-07', '12:00')],
      });

      expect(rowOf(result, '2026-10-07')).toBeUndefined();
      expect(result.closedDates).toContain('2026-10-07');
    });

    it('antes de la contratación y después de la baja no hay jornadas (inclusive en los extremos)', () => {
      const result = run({ employedFrom: '2026-10-07', employedUntil: '2026-10-08' });

      expect(result.workdays.map((workday) => workday.date)).toEqual(['2026-10-07', '2026-10-08']);
      expect(result.closedDates).toHaveLength(7);
    });

    it('sin fecha de baja, todos los días laborables desde la contratación generan jornada', () => {
      const result = run({ employedFrom: '2026-10-07' });

      expect(result.workdays.map((workday) => workday.date)).toEqual([
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
      ]);
    });

    it('contratado el mismo día pedido: ese día cuenta', () => {
      const result = run({ employedFrom: '2026-10-05', employedUntil: '2026-10-05' });

      expect(result.workdays.map((workday) => workday.date)).toEqual(['2026-10-05']);
    });
  });

  describe('fechas abiertas y cerradas', () => {
    it('solo las fechas cuya ventana ya terminó se calculan; las abiertas quedan pendientes sin jornada', () => {
      // Martes a mediodía: la ventana del lunes terminó el martes 05:00; la del martes termina el miércoles 05:00.
      const result = run({
        now: at('2026-10-06', '12:00'),
        punches: [at('2026-10-05', '09:00'), at('2026-10-06', '09:00')],
      });

      expect(result.closedDates).toEqual(['2026-10-05']);
      expect(result.pendingDates).toEqual([
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
      ]);
      expect(result.workdays.map((workday) => workday.date)).toEqual(['2026-10-05']);
    });

    it('la fecha se cierra exactamente cuando empieza la ventana de la siguiente', () => {
      const boundary = at('2026-10-06', '05:00');

      expect(run({ now: boundary }).pendingDates).not.toContain('2026-10-05');
      expect(run({ now: new Date(boundary.getTime() - 1) }).pendingDates).toContain('2026-10-05');
    });

    it('con la hora en el pasado todo está cerrado y no hay pendientes', () => {
      const result = run();

      expect(result.pendingDates).toEqual([]);
      expect(result.closedDates).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
      ]);
    });

    it('un turno nocturno de hoy sigue abierto hasta que cierra su ventana de 24 h', () => {
      const night = (date: string) => plan(date === '2026-10-05' ? NIGHT : REST);
      const options = { first: '2026-10-04', count: 4, planOf: night };

      // La ventana del descanso D+1 empieza a las 18:00 (entrada 22:00 + 24 h − 4 h).
      expect(run({ ...options, now: at('2026-10-06', '17:59') }).pendingDates).toContain(
        '2026-10-05',
      );
      expect(run({ ...options, now: at('2026-10-06', '18:00') }).pendingDates).not.toContain(
        '2026-10-05',
      );
    });
  });

  describe('salida', () => {
    it('solo se calculan las fechas pedidas (calendar[1..n]); los extremos solo dan ventanas vecinas', () => {
      const result = run({
        punches: [at('2026-10-04', '09:00'), at('2026-10-12', '09:00'), at('2026-10-12', '18:00')],
      });

      expect(result.closedDates[0]).toBe('2026-10-05');
      expect(result.closedDates.at(-1)).toBe('2026-10-11');
      expect(result.workdays.some((workday) => workday.date === '2026-10-12')).toBe(false);
      expect(result.workdays.some((workday) => workday.date === '2026-10-04')).toBe(false);
    });

    it('cada jornada lleva el colaborador, la empresa, el turno y la hora de cálculo', () => {
      const now = new Date('2026-11-01T10:00:00Z');
      const result = run({ now });

      expect(result.workdays.length).toBeGreaterThan(0);
      for (const workday of result.workdays) {
        expect(workday).toMatchObject({
          employeeId: EMPLOYEE,
          companyId: COMPANY,
          shiftId: SHIFT,
          calculatedAt: now,
        });
      }
    });

    it('el escenario de la semana: cinco días laborables con jornada y el descanso trabajado, sin fila el domingo', () => {
      const result = run({
        punches: [
          at('2026-10-05', '08:00'),
          at('2026-10-05', '18:00'),
          at('2026-10-06', '09:15'),
          at('2026-10-06', '18:00'),
          at('2026-10-07', '09:10'),
          at('2026-10-07', '18:00'),
          at('2026-10-08', '09:00'),
          at('2026-10-10', '10:00'),
          at('2026-10-10', '12:00'),
        ],
      });

      expect(
        result.workdays.map((w) => [
          w.date,
          w.status,
          w.lateMinutes,
          w.workedMinutes,
          w.overtimeMinutes,
        ]),
      ).toEqual([
        ['2026-10-05', 'ATTENDED', 0, 540, 60],
        ['2026-10-06', 'ATTENDED', 15, 465, 0],
        ['2026-10-07', 'ATTENDED', 0, 470, 0],
        ['2026-10-08', 'ABSENT_SINGLE_PUNCH', 0, 0, 0],
        ['2026-10-09', 'ABSENT_NO_PUNCHES', 0, 0, 0],
        ['2026-10-10', 'REST_WORKED', 0, 120, 120],
      ]);
      expect(result.closedDates).toHaveLength(7);
      expect(result.pendingDates).toEqual([]);
    });
  });
});
