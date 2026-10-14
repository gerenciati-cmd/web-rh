import { describe, expect, it } from 'vitest';

import type { ShiftId } from '../../domain/shift';
import type { Workday } from '../../domain/workday';
import { InMemoryShiftStore } from '../../infrastructure/in-memory/in-memory-shift.store';
import {
  InMemoryWorkdayQueries,
  InMemoryWorkdayRepository,
  InMemoryWorkdayStore,
} from '../../infrastructure/in-memory/in-memory-workday.store';

import { ListEmployeeWorkdays } from './list-employee-workdays.query';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const SHIFT = '00000000-0000-4000-8000-0000000000a1' as ShiftId;
const NOW = new Date('2026-12-01T12:00:00Z');

function workday(date: string, employeeId = EMPLOYEE): Workday {
  return {
    employeeId,
    companyId: COMPANY,
    date,
    shiftId: SHIFT,
    status: 'ABSENT_NO_PUNCHES',
    scheduledStartAt: new Date(`${date}T14:00:00Z`),
    scheduledEndAt: new Date(`${date}T23:00:00Z`),
    scheduledMinutes: 480,
    firstPunchAt: null,
    lastPunchAt: null,
    punchCount: 0,
    lateMinutes: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    calculatedAt: NOW,
  };
}

async function setUp() {
  const shifts = new InMemoryShiftStore();
  const store = new InMemoryWorkdayStore();
  await new InMemoryWorkdayRepository(store).replaceDates(
    EMPLOYEE,
    [],
    [workday('2026-10-07'), workday('2026-10-05'), workday('2026-10-20')],
  );
  await new InMemoryWorkdayRepository(store).replaceDates(
    OTHER_EMPLOYEE,
    [],
    [workday('2026-10-06', OTHER_EMPLOYEE)],
  );
  return new ListEmployeeWorkdays({
    workdayQueries: new InMemoryWorkdayQueries(store, shifts),
    workdayEmployeeDirectory: {
      find: (id: string) =>
        Promise.resolve(
          id === EMPLOYEE
            ? {
                id,
                companyId: COMPANY,
                active: true,
                rfc: null,
                siteId: null,
                hireDate: '2026-01-10',
                terminationDate: null,
              }
            : null,
        ),
    },
  });
}

describe('ListEmployeeWorkdays', () => {
  it('devuelve las jornadas del colaborador dentro del rango, ascendentes y sin las de otros', async () => {
    const result = await (
      await setUp()
    ).execute({ companyId: COMPANY, employeeId: EMPLOYEE, from: '2026-10-05', to: '2026-10-11' });

    expect(result.ok && result.value.items.map((item) => item.date)).toEqual([
      '2026-10-05',
      '2026-10-07',
    ]);
  });

  it('los extremos del rango son inclusivos', async () => {
    const result = await (
      await setUp()
    ).execute({ companyId: COMPANY, employeeId: EMPLOYEE, from: '2026-10-07', to: '2026-10-07' });

    expect(result.ok && result.value.items).toHaveLength(1);
  });

  it('colaborador sin jornadas en el rango: lista vacía, no 404', async () => {
    const result = await (
      await setUp()
    ).execute({ companyId: COMPANY, employeeId: EMPLOYEE, from: '2026-11-01', to: '2026-11-30' });

    expect(result.ok && result.value).toEqual({ items: [] });
  });

  it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
    const result = await (
      await setUp()
    ).execute({
      companyId: COMPANY,
      employeeId: '00000000-0000-4000-8000-0000000000ff',
      from: '2026-10-05',
      to: '2026-10-11',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('colaborador de otra empresa: EMPLOYEE_NOT_FOUND', async () => {
    const result = await (
      await setUp()
    ).execute({
      companyId: OTHER_COMPANY,
      employeeId: EMPLOYEE,
      from: '2026-10-05',
      to: '2026-10-11',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });
});
