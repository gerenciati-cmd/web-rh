import type { WorkdayDto } from '@rrhh/contracts';
import { describe, expect, it } from 'vitest';

import {
  formatLocalDay,
  formatLocalTime,
  formatMinutes,
  formatMonthTitle,
  monthSummary,
  previousMonth,
  workdayStatusView,
} from './format';

function workday(overrides: Partial<WorkdayDto> = {}): WorkdayDto {
  return {
    date: '2026-11-10',
    shiftId: '00000000-0000-4000-8000-0000000000a1',
    shiftName: 'Oficina',
    status: 'ATTENDED',
    scheduledStartAt: '2026-11-10T14:00:00.000Z',
    scheduledEndAt: '2026-11-10T23:00:00.000Z',
    scheduledMinutes: 480,
    firstPunchAt: '2026-11-10T13:56:00.000Z',
    lastPunchAt: '2026-11-10T23:05:00.000Z',
    punchCount: 2,
    lateMinutes: 0,
    workedMinutes: 480,
    overtimeMinutes: 0,
    calculatedAt: '2026-11-11T10:00:00.000Z',
    ...overrides,
  };
}

describe('formatMinutes', () => {
  it.each([
    [0, '0 min'],
    [45, '45 min'],
    [59, '59 min'],
    [60, '1 h'],
    [480, '8 h'],
    [485, '8 h 05'],
    [525, '8 h 45'],
  ])('%i minutos se muestra como %s', (minutes, expected) => {
    expect(formatMinutes(minutes)).toBe(expected);
  });
});

describe('formatLocalTime', () => {
  it('usa la zona de la sede (Cancún, UTC-5)', () => {
    expect(formatLocalTime('2026-11-10T13:56:00Z', 'America/Cancun')).toBe('08:56');
  });

  it('el mismo instante en otra zona da otra hora (Ciudad de México, UTC-6 en noviembre)', () => {
    expect(formatLocalTime('2026-11-10T13:56:00Z', 'America/Mexico_City')).toBe('07:56');
  });

  it('muestra 24 h, no 12 h', () => {
    expect(formatLocalTime('2026-11-10T23:30:00Z', 'America/Cancun')).toBe('18:30');
  });

  it('la medianoche local es 00:xx, no 24:xx', () => {
    expect(formatLocalTime('2026-11-10T05:05:00Z', 'America/Cancun')).toBe('00:05');
  });

  it('cruza el día respecto a UTC: 23:30 local es de madrugada en UTC', () => {
    expect(formatLocalTime('2026-11-11T04:30:00Z', 'America/Cancun')).toBe('23:30');
  });
});

describe('formatLocalDay', () => {
  it('muestra día de la semana, día y mes abreviados con la inicial en mayúscula', () => {
    expect(formatLocalDay('2026-11-10')).toBe('Mar 10 nov');
  });

  it('es una fecha de calendario: no se corre un día por la zona del proceso', () => {
    expect(formatLocalDay('2026-11-01')).toBe('Dom 1 nov');
    expect(formatLocalDay('2026-12-31')).toBe('Jue 31 dic');
  });
});

describe('formatMonthTitle', () => {
  it('2026-11 es Noviembre 2026', () => {
    expect(formatMonthTitle('2026-11')).toBe('Noviembre 2026');
  });

  it.each([
    ['2026-01', 'Enero 2026'],
    ['2026-09', 'Septiembre 2026'],
    ['2026-12', 'Diciembre 2026'],
  ])('%s es %s', (month, expected) => {
    expect(formatMonthTitle(month)).toBe(expected);
  });
});

describe('workdayStatusView', () => {
  it('ATTENDED con retardo: advertencia con los minutos', () => {
    expect(workdayStatusView(workday({ lateMinutes: 12 }))).toEqual({
      label: 'Retardo 12 min',
      tone: 'warning',
      detail: null,
    });
  });

  it('ATTENDED sin retardo: Asistencia en éxito', () => {
    expect(workdayStatusView(workday({ lateMinutes: 0 }))).toEqual({
      label: 'Asistencia',
      tone: 'success',
      detail: null,
    });
  });

  it('ABSENT_NO_PUNCHES: Falta con motivo "Sin marcaciones"', () => {
    expect(workdayStatusView(workday({ status: 'ABSENT_NO_PUNCHES' }))).toEqual({
      label: 'Falta',
      tone: 'danger',
      detail: 'Sin marcaciones',
    });
  });

  it('ABSENT_SINGLE_PUNCH: Falta con motivo "Una sola marcación"', () => {
    expect(workdayStatusView(workday({ status: 'ABSENT_SINGLE_PUNCH' }))).toEqual({
      label: 'Falta',
      tone: 'danger',
      detail: 'Una sola marcación',
    });
  });

  it('REST_WORKED: Descanso trabajado en sand', () => {
    expect(workdayStatusView(workday({ status: 'REST_WORKED' }))).toEqual({
      label: 'Descanso trabajado',
      tone: 'sand',
      detail: null,
    });
  });
});

describe('monthSummary', () => {
  it('un mes vacío da todo en cero', () => {
    expect(monthSummary([])).toEqual({
      attended: 0,
      late: 0,
      absences: 0,
      overtimeMinutes: 0,
      restWorked: 0,
    });
  });

  it('cuenta cada estado; attended incluye los retardos y las faltas suman ambos tipos', () => {
    const items = [
      workday({ lateMinutes: 0 }),
      workday({ lateMinutes: 15 }),
      workday({ status: 'ABSENT_NO_PUNCHES' }),
      workday({ status: 'ABSENT_SINGLE_PUNCH' }),
      workday({ status: 'REST_WORKED' }),
    ];

    expect(monthSummary(items)).toEqual({
      attended: 2,
      late: 1,
      absences: 2,
      overtimeMinutes: 0,
      restWorked: 1,
    });
  });

  it('suma las horas extra de todas las jornadas, descansos trabajados incluidos', () => {
    const items = [
      workday({ overtimeMinutes: 30 }),
      workday({ status: 'REST_WORKED', overtimeMinutes: 240 }),
      workday({ overtimeMinutes: 0 }),
    ];

    expect(monthSummary(items).overtimeMinutes).toBe(270);
  });
});

describe('previousMonth', () => {
  it('resta un mes dentro del año', () => {
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });

  it('enero retrocede a diciembre del año anterior', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
  });
});
