import { describe, expect, it } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import type { ShiftId } from '../../domain/shift';
import type { Workday } from '../../domain/workday';
import { InMemoryShiftStore } from '../../infrastructure/in-memory/in-memory-shift.store';
import {
  InMemoryWorkdayQueries,
  InMemoryWorkdayRepository,
  InMemoryWorkdayStore,
} from '../../infrastructure/in-memory/in-memory-workday.store';
import type { WorkdayEmployee } from '../ports/workday-employee-directory';

import { ListMyWorkdays } from './list-my-workdays.query';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const NO_SITE_EMPLOYEE = '00000000-0000-4000-8000-0000000000e3';
const GHOST_SITE_EMPLOYEE = '00000000-0000-4000-8000-0000000000e4';
const SITE = '00000000-0000-4000-8000-0000000000b1';
const GHOST_SITE = '00000000-0000-4000-8000-0000000000b9';
const SHIFT = '00000000-0000-4000-8000-0000000000a1' as ShiftId;

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
    calculatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function employee(id: string, siteId: string | null): WorkdayEmployee {
  return {
    id,
    companyId: COMPANY,
    active: true,
    rfc: null,
    siteId,
    hireDate: '2020-01-10',
    terminationDate: null,
  };
}

const EMPLOYEES = new Map<string, WorkdayEmployee>([
  [EMPLOYEE, employee(EMPLOYEE, SITE)],
  [NO_SITE_EMPLOYEE, employee(NO_SITE_EMPLOYEE, null)],
  [GHOST_SITE_EMPLOYEE, employee(GHOST_SITE_EMPLOYEE, GHOST_SITE)],
]);

/** Sede en Cancún (UTC−5): la fecha "de hoy" se decide en esa zona, no en UTC. */
async function setUp(now: string, dates: string[] = []) {
  const store = new InMemoryWorkdayStore();
  const repository = new InMemoryWorkdayRepository(store);
  await repository.replaceDates(
    EMPLOYEE,
    [],
    dates.map((date) => workday(date)),
  );
  await repository.replaceDates(
    OTHER_EMPLOYEE,
    [],
    dates.map((date) => workday(date, OTHER_EMPLOYEE)),
  );
  return new ListMyWorkdays({
    workdayQueries: new InMemoryWorkdayQueries(store, new InMemoryShiftStore()),
    workdayEmployeeDirectory: { find: (id) => Promise.resolve(EMPLOYEES.get(id) ?? null) },
    deviceSiteDirectory: {
      find: (id) =>
        Promise.resolve(id === SITE ? { id, timeZone: 'America/Cancun', active: true } : null),
    },
    clock: new FixedClock(new Date(now)),
  });
}

const NOV_10 = '2026-11-10T15:00:00Z';

describe('ListMyWorkdays', () => {
  it('cuenta sin colaborador vinculado: ACCOUNT_NOT_LINKED', async () => {
    const result = await (await setUp(NOV_10)).execute({ employeeId: null, month: '2026-11' });

    expect(!result.ok && result.error.code).toBe('ACCOUNT_NOT_LINKED');
  });

  it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
    const result = await (
      await setUp(NOV_10)
    ).execute({ employeeId: '00000000-0000-4000-8000-0000000000ff', month: '2026-11' });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('colaborador sin sede: EMPLOYEE_WITHOUT_SITE', async () => {
    const result = await (
      await setUp(NOV_10)
    ).execute({ employeeId: NO_SITE_EMPLOYEE, month: '2026-11' });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_WITHOUT_SITE');
  });

  it('sede que ya no existe: SITE_NOT_FOUND', async () => {
    const result = await (
      await setUp(NOV_10)
    ).execute({ employeeId: GHOST_SITE_EMPLOYEE, month: '2026-11' });

    expect(!result.ok && result.error.code).toBe('SITE_NOT_FOUND');
  });

  it('mes actual: devuelve solo las jornadas propias de ese mes, ascendentes', async () => {
    const result = await (
      await setUp(NOV_10, ['2026-11-04', '2026-11-02', '2026-10-30'])
    ).execute({ employeeId: EMPLOYEE, month: '2026-11' });

    expect(result.ok && result.value.month).toBe('2026-11');
    expect(result.ok && result.value.items.map((item) => item.date)).toEqual([
      '2026-11-02',
      '2026-11-04',
    ]);
  });

  it('mes anterior: 200 con sus jornadas', async () => {
    const result = await (
      await setUp(NOV_10, ['2026-11-04', '2026-10-30'])
    ).execute({ employeeId: EMPLOYEE, month: '2026-10' });

    expect(result.ok && result.value.items.map((item) => item.date)).toEqual(['2026-10-30']);
  });

  it('mes actual sin jornadas: lista vacía, no error', async () => {
    const result = await (await setUp(NOV_10)).execute({ employeeId: EMPLOYEE, month: '2026-11' });

    expect(result.ok && result.value).toEqual({ month: '2026-11', items: [] });
  });

  it.each([
    ['dos meses atrás', '2026-09'],
    ['un mes futuro', '2026-12'],
    ['el mismo mes de otro año', '2025-11'],
  ])('%s: MONTH_NOT_AVAILABLE con el mes en los detalles', async (_name, month) => {
    const result = await (await setUp(NOV_10)).execute({ employeeId: EMPLOYEE, month });

    expect(!result.ok && result.error.code).toBe('MONTH_NOT_AVAILABLE');
    expect(!result.ok && result.error.details).toEqual({ month });
  });

  it('en enero el mes anterior es diciembre del año previo', async () => {
    const use = await setUp('2026-01-15T12:00:00Z', ['2025-12-31']);

    const previous = await use.execute({ employeeId: EMPLOYEE, month: '2025-12' });
    const older = await use.execute({ employeeId: EMPLOYEE, month: '2025-11' });

    expect(previous.ok && previous.value.items).toHaveLength(1);
    expect(!older.ok && older.error.code).toBe('MONTH_NOT_AVAILABLE');
  });

  it('"hoy" se decide en la zona de la sede: 04:30 UTC del 1 de diciembre sigue siendo noviembre en Cancún', async () => {
    const use = await setUp('2026-12-01T04:30:00Z', ['2026-11-30']);

    const november = await use.execute({ employeeId: EMPLOYEE, month: '2026-11' });
    const december = await use.execute({ employeeId: EMPLOYEE, month: '2026-12' });
    const october = await use.execute({ employeeId: EMPLOYEE, month: '2026-10' });

    expect(november.ok && november.value.items).toHaveLength(1);
    expect(!december.ok && december.error.code).toBe('MONTH_NOT_AVAILABLE');
    expect(october.ok).toBe(true);
  });

  it.each([
    ['febrero de 28 días', '2026-02', '2026-02-28', '2026-03-01', '2026-03-10T15:00:00Z'],
    ['febrero bisiesto de 29 días', '2028-02', '2028-02-29', '2028-03-01', '2028-03-10T15:00:00Z'],
    ['abril de 30 días', '2026-04', '2026-04-30', '2026-05-01', '2026-05-10T15:00:00Z'],
    ['octubre de 31 días', '2026-10', '2026-10-31', '2026-11-01', '2026-11-10T15:00:00Z'],
    ['diciembre de 31 días', '2026-12', '2026-12-31', '2027-01-01', '2027-01-10T15:00:00Z'],
  ])(
    '%s: incluye el último día y deja fuera el primero del mes siguiente',
    async (_name, month, lastDay, nextFirst, now) => {
      const result = await (
        await setUp(now, [`${month}-01`, lastDay, nextFirst])
      ).execute({ employeeId: EMPLOYEE, month });

      expect(result.ok && result.value.items.map((item) => item.date)).toEqual([
        `${month}-01`,
        lastDay,
      ]);
    },
  );
});
