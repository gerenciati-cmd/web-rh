import { describe, expect, it } from 'vitest';

import { Shift, type ShiftId } from '@/modules/attendance/domain/shift';
import type { Workday } from '@/modules/attendance/domain/workday';
import { PrismaShiftRepository } from '@/modules/attendance/infrastructure/prisma-shift.repository';
import { PrismaWorkdayQueries } from '@/modules/attendance/infrastructure/prisma-workday.queries';
import { PrismaWorkdayRepository } from '@/modules/attendance/infrastructure/prisma-workday.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

// El TRUNCATE ... CASCADE encadena workdays con shifts por FK; se listan ambas.
const database = useTestDatabase(['attendance.workdays', 'attendance.shifts']);
const shifts = new PrismaShiftRepository({ database });
const workdays = new PrismaWorkdayRepository({ database });
const queries = new PrismaWorkdayQueries({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-12-01T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';

async function savedShift(): Promise<Shift> {
  const created = Shift.create({
    id: ids.next() as ShiftId,
    companyId: COMPANY,
    name: 'Oficina',
    cycleStartDate: '2026-10-05',
    toleranceMinutes: 10,
    days: [{ type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 }],
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await shifts.add(created.value);
  if (!saved.ok) throw saved.error;
  return created.value;
}

function workday(shift: Shift, date: string, overrides: Partial<Workday> = {}): Workday {
  return {
    employeeId: EMPLOYEE,
    companyId: COMPANY,
    date,
    shiftId: shift.id,
    status: 'ATTENDED',
    scheduledStartAt: new Date(`${date}T14:00:00Z`),
    scheduledEndAt: new Date(`${date}T23:00:00Z`),
    scheduledMinutes: 480,
    firstPunchAt: new Date(`${date}T14:30:00Z`),
    lastPunchAt: new Date(`${date}T23:00:00Z`),
    punchCount: 2,
    lateMinutes: 30,
    workedMinutes: 450,
    overtimeMinutes: 0,
    calculatedAt: NOW,
    ...overrides,
  };
}

describe('ABSENT_LATENESS en la base', () => {
  it('una jornada ABSENT_LATENESS se guarda y se lee con sus minutos de retardo intactos', async () => {
    const shift = await savedShift();
    const stored = workday(shift, '2026-11-05', { status: 'ABSENT_LATENESS', lateMinutes: 42 });

    await workdays.replaceDates(EMPLOYEE, ['2026-11-05'], [stored]);

    const rows = await database.client.$queryRawUnsafe<{ status: string; late_minutes: number }[]>(
      `SELECT status, late_minutes FROM attendance.workdays`,
    );
    expect(rows).toEqual([{ status: 'ABSENT_LATENESS', late_minutes: 42 }]);
    const [dto] = await queries.listByEmployee(EMPLOYEE, '2026-11-05', '2026-11-05');
    expect(dto).toMatchObject({ status: 'ABSENT_LATENESS', lateMinutes: 42 });
    expect(await workdays.listBetween(EMPLOYEE, '2026-11-05', '2026-11-05')).toEqual([stored]);
  });
});

describe('PrismaWorkdayRepository.listBetween', () => {
  it('devuelve las jornadas del colaborador con la forma de dominio, intacta (ida y vuelta)', async () => {
    const shift = await savedShift();
    const first = workday(shift, '2026-11-02');
    const rest = workday(shift, '2026-11-07', {
      status: 'REST_WORKED',
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduledMinutes: 0,
      lateMinutes: 0,
    });
    const absent = workday(shift, '2026-11-03', {
      status: 'ABSENT_NO_PUNCHES',
      firstPunchAt: null,
      lastPunchAt: null,
      punchCount: 0,
      lateMinutes: 0,
      workedMinutes: 0,
    });
    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-11-02', '2026-11-03', '2026-11-07'],
      [first, rest, absent],
    );

    const result = await workdays.listBetween(EMPLOYEE, '2026-11-01', '2026-11-30');

    expect(result).toEqual([first, absent, rest]);
  });

  it('ordena ascendente por fecha', async () => {
    const shift = await savedShift();
    const dates = ['2026-11-09', '2026-11-02', '2026-11-05'];
    await workdays.replaceDates(
      EMPLOYEE,
      dates,
      dates.map((date) => workday(shift, date)),
    );

    const result = await workdays.listBetween(EMPLOYEE, '2026-11-01', '2026-11-30');

    expect(result.map((item) => item.date)).toEqual(['2026-11-02', '2026-11-05', '2026-11-09']);
  });

  it('los extremos son inclusivos y lo de fuera del rango no sale', async () => {
    const shift = await savedShift();
    const dates = ['2026-11-01', '2026-11-02', '2026-11-15', '2026-11-16'];
    await workdays.replaceDates(
      EMPLOYEE,
      dates,
      dates.map((date) => workday(shift, date)),
    );

    const result = await workdays.listBetween(EMPLOYEE, '2026-11-02', '2026-11-15');

    expect(result.map((item) => item.date)).toEqual(['2026-11-02', '2026-11-15']);
  });

  it('no devuelve jornadas de otro colaborador', async () => {
    const shift = await savedShift();
    await workdays.replaceDates(EMPLOYEE, ['2026-11-02'], [workday(shift, '2026-11-02')]);
    await workdays.replaceDates(
      OTHER_EMPLOYEE,
      ['2026-11-03'],
      [workday(shift, '2026-11-03', { employeeId: OTHER_EMPLOYEE })],
    );

    const result = await workdays.listBetween(EMPLOYEE, '2026-11-01', '2026-11-30');

    expect(result.map((item) => item.date)).toEqual(['2026-11-02']);
  });

  it('un rango sin jornadas devuelve una lista vacía', async () => {
    expect(await workdays.listBetween(EMPLOYEE, '2026-11-01', '2026-11-30')).toEqual([]);
  });
});
