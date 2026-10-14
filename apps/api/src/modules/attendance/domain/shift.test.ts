import { describe, expect, it } from 'vitest';

import { Shift, workMinutes, type ShiftDay, type ShiftId, type WorkShiftDay } from './shift';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const NOW = new Date('2026-10-14T12:00:00Z');

const WORK: ShiftDay = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const REST: ShiftDay = { type: 'REST' };

function create(overrides: Partial<Parameters<typeof Shift.create>[0]> = {}) {
  return Shift.create({
    id: 'shift-1' as ShiftId,
    companyId: COMPANY,
    name: 'Oficina',
    cycleStartDate: '2026-11-02',
    toleranceMinutes: 10,
    days: [WORK, WORK, WORK, WORK, WORK, REST, REST],
    now: NOW,
    ...overrides,
  });
}

function created(overrides: Partial<Parameters<typeof Shift.create>[0]> = {}): Shift {
  const result = create(overrides);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('Shift.create', () => {
  it('crea un turno activo con el nombre recortado y su clave en minúsculas', () => {
    const shift = created({ name: '  Turno Matutino  ' });

    expect(shift.name).toBe('Turno Matutino');
    expect(shift.nameKey).toBe('turno matutino');
    expect(shift.active).toBe(true);
    expect(shift.companyId).toBe(COMPANY);
    expect(shift.createdAt).toEqual(NOW);
    expect(shift.toleranceMinutes).toBe(10);
    expect(shift.cycleStartDate).toBe('2026-11-02');
    expect(shift.days).toHaveLength(7);
  });

  it('no emite eventos de dominio', () => {
    expect(created().pullEvents()).toEqual([]);
  });

  it('acepta un turno nocturno y uno de 24x24', () => {
    expect(create({ days: [{ ...WORK, start: '22:00', end: '06:00' }] }).ok).toBe(true);
    expect(
      create({ days: [{ type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 0 }, REST] })
        .ok,
    ).toBe(true);
  });

  it('acepta un ciclo de 1 y de 28 días, y tolerancia en los extremos', () => {
    expect(create({ days: [WORK] }).ok).toBe(true);
    expect(create({ days: [WORK, ...Array.from({ length: 27 }, () => REST)] }).ok).toBe(true);
    expect(create({ toleranceMinutes: 0 }).ok).toBe(true);
    expect(create({ toleranceMinutes: 60 }).ok).toBe(true);
  });

  it.each([
    ['nombre vacío', { name: '   ' }],
    ['nombre de 101 caracteres', { name: 'x'.repeat(101) }],
    ['fecha de inicio con formato inválido', { cycleStartDate: '02/11/2026' }],
    ['fecha de inicio que no existe en el calendario', { cycleStartDate: '2026-02-30' }],
    ['tolerancia negativa', { toleranceMinutes: -1 }],
    ['tolerancia mayor a 60', { toleranceMinutes: 61 }],
    ['tolerancia fraccionaria', { toleranceMinutes: 5.5 }],
    ['ciclo vacío', { days: [] }],
    ['ciclo de 29 días', { days: [WORK, ...Array.from({ length: 28 }, () => REST)] }],
    ['ciclo sin día laborable', { days: [REST, REST] }],
    ['hora de entrada 24:00', { days: [{ ...WORK, start: '24:00' }] }],
    ['hora de salida mal formada', { days: [{ ...WORK, end: '9:00' }] }],
    ['comida negativa', { days: [{ ...WORK, mealBreakMinutes: -1 }] }],
    ['comida mayor a 120', { days: [{ ...WORK, mealBreakMinutes: 121 }] }],
    ['comida igual a la jornada', { days: [{ ...WORK, start: '09:00', end: '10:00' }] }],
    [
      'comida mayor a la jornada nocturna',
      { days: [{ ...WORK, start: '23:00', end: '00:30', mealBreakMinutes: 90 }] },
    ],
  ] as const)('rechaza %s con INVALID_VALUE', (_name, override) => {
    const result = create(override);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('acepta una comida un minuto menor que la jornada', () => {
    const result = create({
      days: [{ type: 'WORK', start: '09:00', end: '10:00', mealBreakMinutes: 59 }],
    });

    expect(result.ok).toBe(true);
  });

  it('copia los días: mutar la entrada no altera el turno', () => {
    const days: ShiftDay[] = [{ ...WORK }];
    const shift = created({ days });
    if (days[0]?.type === 'WORK') days[0].start = '01:00';

    expect(shift.days[0]).toEqual(WORK);
  });
});

describe('Shift.dayOn', () => {
  it('un ciclo semanal anclado a un lunes: lunes a viernes laboran, fin de semana descansa', () => {
    const shift = created();

    expect(shift.dayOn('2026-11-02')).toEqual(WORK);
    expect(shift.dayOn('2026-11-06')).toEqual(WORK);
    expect(shift.dayOn('2026-11-07')).toEqual(REST);
    expect(shift.dayOn('2026-11-08')).toEqual(REST);
    expect(shift.dayOn('2026-11-09')).toEqual(WORK);
  });

  it('un ciclo de 2 días alterna', () => {
    const shift = created({ days: [WORK, REST] });

    expect(shift.dayOn('2026-11-02')).toEqual(WORK);
    expect(shift.dayOn('2026-11-03')).toEqual(REST);
    expect(shift.dayOn('2026-11-04')).toEqual(WORK);
  });

  it('un ciclo de 14 días vuelve al día 1 a los 14 días', () => {
    const second: ShiftDay = { type: 'WORK', start: '07:00', end: '15:00', mealBreakMinutes: 30 };
    const days = [WORK, ...Array.from({ length: 12 }, () => REST), second];
    const shift = created({ days });

    expect(shift.dayOn('2026-11-02')).toEqual(WORK);
    expect(shift.dayOn('2026-11-15')).toEqual(second);
    expect(shift.dayOn('2026-11-16')).toEqual(WORK);
    expect(shift.dayOn('2026-11-29')).toEqual(second);
  });

  it('las fechas anteriores a cycleStartDate también resuelven (el ciclo se repite hacia atrás)', () => {
    const shift = created();

    expect(shift.dayOn('2026-11-01')).toEqual(REST);
    expect(shift.dayOn('2026-10-31')).toEqual(REST);
    expect(shift.dayOn('2026-10-30')).toEqual(WORK);
    expect(shift.dayOn('2026-10-26')).toEqual(WORK);
    expect(shift.dayOn('2025-11-03')).toEqual(WORK);
  });

  it('cruza el cambio de horario de verano sin desfasar el día', () => {
    const shift = created({ cycleStartDate: '2026-03-01', days: [WORK, REST] });

    // Se calcula en UTC: 8 días desde el inicio es par (WORK) y 246 días hasta noviembre también.
    expect(shift.dayOn('2026-03-09')).toEqual(WORK);
    expect(shift.dayOn('2026-03-10')).toEqual(REST);
    expect(shift.dayOn('2026-11-02')).toEqual(WORK);
  });
});

describe('workMinutes', () => {
  const work = (start: string, end: string, mealBreakMinutes: number): WorkShiftDay => ({
    type: 'WORK',
    start,
    end,
    mealBreakMinutes,
  });

  it('jornada diurna: duración menos comida', () => {
    expect(workMinutes(work('09:00', '18:00', 60))).toBe(480);
  });

  it('jornada sin comida', () => {
    expect(workMinutes(work('08:00', '12:00', 0))).toBe(240);
  });

  it('jornada nocturna: termina al día siguiente', () => {
    expect(workMinutes(work('22:00', '06:00', 30))).toBe(450);
  });

  it('salida igual a la entrada: 24 horas', () => {
    expect(workMinutes(work('08:00', '08:00', 0))).toBe(1440);
    expect(workMinutes(work('08:00', '08:00', 60))).toBe(1380);
  });
});
