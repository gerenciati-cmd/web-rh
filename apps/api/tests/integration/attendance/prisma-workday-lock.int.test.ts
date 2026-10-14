import { describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import { RecalculateWorkdays } from '@/modules/attendance/application/commands/recalculate-workdays.command';
import { Device, type DeviceId } from '@/modules/attendance/domain/device';
import { Punch, type PunchId } from '@/modules/attendance/domain/punch';
import { Shift, type ShiftId } from '@/modules/attendance/domain/shift';
import type { Workday } from '@/modules/attendance/domain/workday';
import { PrismaDeviceRepository } from '@/modules/attendance/infrastructure/prisma-device.repository';
import { PrismaPunchRepository } from '@/modules/attendance/infrastructure/prisma-punch.repository';
import { PrismaShiftAssignmentRepository } from '@/modules/attendance/infrastructure/prisma-shift-assignment.repository';
import { PrismaShiftRepository } from '@/modules/attendance/infrastructure/prisma-shift.repository';
import { PrismaWorkdayQueries } from '@/modules/attendance/infrastructure/prisma-workday.queries';
import { PrismaWorkdayRepository } from '@/modules/attendance/infrastructure/prisma-workday.repository';
import { FixedClock, SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

/**
 * Plan attendance-asistencia-diaria/003, deviación 4: `lockEmployee` usa un candado consultivo de
 * transacción (`pg_advisory_xact_lock`). Aquí se prueba contra Postgres real que de verdad pone en
 * fila a dos recálculos del mismo colaborador (002 review, Low-2) y que sin él chocarían.
 */
const database = useTestDatabase([
  'attendance.workdays',
  'attendance.shift_assignments',
  'attendance.shifts',
  'attendance.punches',
  'attendance.devices',
]);
const shifts = new PrismaShiftRepository({ database });
const assignments = new PrismaShiftAssignmentRepository({ database });
const devices = new PrismaDeviceRepository({ database });
const punches = new PrismaPunchRepository({ database });
const workdays = new PrismaWorkdayRepository({ database });
const queries = new PrismaWorkdayQueries({ database });
const transactionRunner = new PrismaTransactionRunner({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-12-01T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const SITE = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const RFC = 'GOMA850101AB1';

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Espera (con tope) a que una condición asíncrona se cumpla; sin sleeps de duración fija. */
async function eventually(condition: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((wake) => setTimeout(wake, 20));
  }
  throw new Error(`No se cumplió a tiempo: ${what}`);
}

/** Candados consultivos que algún backend de esta base está esperando. */
async function waitingAdvisoryLocks(): Promise<number> {
  const [row] = await database.client.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_locks
     WHERE locktype = 'advisory' AND NOT granted
       AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  return row?.n ?? 0;
}

/** Backends de esta base bloqueados esperando a otra transacción (p. ej. una llave única). */
async function backendsWaitingOnTransactions(): Promise<number> {
  const [row] = await database.client.$queryRaw<{ n: number }[]>`
    SELECT count(*)::int AS n FROM pg_stat_activity
     WHERE datname = current_database() AND wait_event_type = 'Lock'`;
  return row?.n ?? 0;
}

async function savedShift(): Promise<Shift> {
  const created = Shift.create({
    id: ids.next() as ShiftId,
    companyId: COMPANY,
    name: 'Diario',
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

function workday(shift: Shift, date: string, status: Workday['status']): Workday {
  return {
    employeeId: EMPLOYEE,
    companyId: COMPANY,
    date,
    shiftId: shift.id,
    status,
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

async function statuses(): Promise<string[]> {
  const rows = await queries.listByEmployee(EMPLOYEE, '2026-10-01', '2026-10-31');
  return rows.map((row) => `${row.date}:${row.status}`);
}

describe('PrismaWorkdayRepository.lockEmployee contra Postgres', () => {
  it('un segundo recálculo del mismo colaborador espera hasta que el primero termina su transacción', async () => {
    const order: string[] = [];
    const holding = deferred();
    const release = deferred();

    const first = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      order.push('A toma el candado');
      holding.resolve();
      await release.promise;
      order.push('A termina');
    });
    await holding.promise;
    const second = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      order.push('B toma el candado');
    });

    // Prueba objetiva de la espera: Postgres tiene un candado consultivo sin conceder.
    await eventually(async () => (await waitingAdvisoryLocks()) === 1, 'B esperando el candado');
    expect(order).toEqual(['A toma el candado']);

    release.resolve();
    await Promise.all([first, second]);

    expect(order).toEqual(['A toma el candado', 'A termina', 'B toma el candado']);
    expect(await waitingAdvisoryLocks()).toBe(0);
  });

  it('no bloquea a otro colaborador mientras el primero lo mantiene', async () => {
    const holding = deferred();
    const release = deferred();
    const first = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      holding.resolve();
      await release.promise;
    });
    await holding.promise;

    // Si el candado fuera global, esto se colgaría hasta el tope del test.
    await database.inTransaction(() => workdays.lockEmployee(OTHER_EMPLOYEE));

    release.resolve();
    await first;
  });

  it('el candado se libera también al revertir: el que esperaba continúa', async () => {
    const holding = deferred();
    const release = deferred();
    const first = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      holding.resolve();
      await release.promise;
      throw new Error('falla a media transacción');
    });
    const firstOutcome = first.then(
      () => 'ok',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    await holding.promise;
    const second = database.inTransaction(() => workdays.lockEmployee(EMPLOYEE));
    await eventually(async () => (await waitingAdvisoryLocks()) === 1, 'B esperando el candado');

    release.resolve();

    expect(await firstOutcome).toBe('falla a media transacción');
    await second;
  });

  it('control: sin el candado dos reemplazos concurrentes de la misma fecha chocan en la llave primaria', async () => {
    const shift = await savedShift();
    const holding = deferred();
    const release = deferred();

    const first = database.inTransaction(async () => {
      await workdays.replaceDates(
        EMPLOYEE,
        ['2026-10-05'],
        [workday(shift, '2026-10-05', 'ATTENDED')],
      );
      holding.resolve();
      await release.promise;
    });
    await holding.promise;
    const second = database.inTransaction(() =>
      workdays.replaceDates(
        EMPLOYEE,
        ['2026-10-05'],
        [workday(shift, '2026-10-05', 'ABSENT_NO_PUNCHES')],
      ),
    );
    const secondOutcome = second.then(
      () => 'ok',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    // B ya borró (nada que borrar) y su insert espera la fila sin confirmar de A.
    await eventually(async () => (await backendsWaitingOnTransactions()) >= 1, 'B esperando a A');

    release.resolve();
    await first;

    expect(await secondOutcome).toMatch(/unique constraint|duplicate key/i);
    expect(await statuses()).toEqual(['2026-10-05:ATTENDED']);
  });

  it('con el candado la misma carrera se serializa: ninguno falla y queda la fila del último', async () => {
    const shift = await savedShift();
    const holding = deferred();
    const release = deferred();

    const first = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      await workdays.replaceDates(
        EMPLOYEE,
        ['2026-10-05'],
        [workday(shift, '2026-10-05', 'ATTENDED')],
      );
      holding.resolve();
      await release.promise;
    });
    await holding.promise;
    const second = database.inTransaction(async () => {
      await workdays.lockEmployee(EMPLOYEE);
      await workdays.replaceDates(
        EMPLOYEE,
        ['2026-10-05'],
        [workday(shift, '2026-10-05', 'ABSENT_NO_PUNCHES')],
      );
    });
    await eventually(async () => (await waitingAdvisoryLocks()) === 1, 'B esperando el candado');

    release.resolve();
    await Promise.all([first, second]);

    expect(await statuses()).toEqual(['2026-10-05:ABSENT_NO_PUNCHES']);
    expect(await database.client.attendanceWorkday.count()).toBe(1);
  });
});

describe('RecalculateWorkdays concurrente contra Postgres', () => {
  async function setUpEmployee() {
    const shift = await savedShift();
    await assignments.put({
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      shiftId: shift.id,
      effectiveFrom: '2026-10-05',
      assignedAt: NOW,
      assignedBy: USER,
    });
    const device = Device.register({
      id: ids.next() as DeviceId,
      serialNumber: 'SNLOCK01',
      name: 'Equipo SNLOCK01',
      siteId: SITE,
      timeZone: 'America/Cancun',
      now: NOW,
    });
    if (!device.ok) throw device.error;
    const savedDevice = await devices.add(device.value);
    if (!savedDevice.ok) throw savedDevice.error;
    const punch = (deviceTime: string) => {
      const created = Punch.fromDevice({
        id: ids.next() as PunchId,
        deviceId: device.value.id,
        timeZone: 'America/Cancun',
        pin: RFC,
        deviceTime,
        status: '0',
        verifyMode: '1',
        receivedAt: NOW,
      });
      if (!created.ok) throw created.error;
      return created.value;
    };
    await punches.saveNew([punch('2026-10-05 08:55:00'), punch('2026-10-05 18:00:00')]);
  }

  const command = () =>
    new RecalculateWorkdays({
      workdayEmployeeDirectory: {
        find: () =>
          Promise.resolve({
            id: EMPLOYEE,
            companyId: COMPANY,
            active: true,
            rfc: RFC,
            siteId: SITE,
            hireDate: '2026-01-10',
            terminationDate: null,
          }),
      },
      deviceSiteDirectory: {
        find: () => Promise.resolve({ id: SITE, timeZone: 'America/Cancun', active: true }),
      },
      shiftAssignmentRepository: assignments,
      shiftRepository: shifts,
      punchRepository: punches,
      workdayRepository: workdays,
      transactionRunner,
      clock: new FixedClock(NOW),
    });
  const input = { companyId: COMPANY, employeeId: EMPLOYEE, from: '2026-10-05', to: '2026-10-11' };

  it('varios recálculos simultáneos del mismo colaborador y rango responden ok y dejan las mismas filas que uno solo', async () => {
    await setUpEmployee();
    await command().execute(input);
    const expected = await statuses();
    await database.client.$executeRawUnsafe(`TRUNCATE "attendance"."workdays"`);
    expect(await statuses()).toEqual([]);

    const results = await Promise.all(Array.from({ length: 5 }, () => command().execute(input)));

    for (const result of results) {
      expect(result.ok && result.value).toEqual({
        recalculatedDates: 7,
        storedWorkdays: 7,
        pendingDates: [],
      });
    }
    expect(await statuses()).toEqual(expected);
    expect(expected).toEqual([
      '2026-10-05:ATTENDED',
      '2026-10-06:ABSENT_NO_PUNCHES',
      '2026-10-07:ABSENT_NO_PUNCHES',
      '2026-10-08:ABSENT_NO_PUNCHES',
      '2026-10-09:ABSENT_NO_PUNCHES',
      '2026-10-10:ABSENT_NO_PUNCHES',
      '2026-10-11:ABSENT_NO_PUNCHES',
    ]);
    expect(await database.client.attendanceWorkday.count()).toBe(7);
  });
});
