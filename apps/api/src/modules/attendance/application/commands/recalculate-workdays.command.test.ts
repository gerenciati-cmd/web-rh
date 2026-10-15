import { describe, expect, it } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import type { DeviceId } from '../../domain/device';
import { Punch, type PunchId } from '../../domain/punch';
import { Shift, type ShiftDay, type ShiftId } from '../../domain/shift';
import type { ShiftRepository } from '../../domain/shift.repository';
import type { Workday } from '../../domain/workday';
import type { WorkdayRepository } from '../../domain/workday.repository';
import {
  InMemoryAttendanceStore,
  InMemoryPunchRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';
import {
  InMemoryShiftAssignmentRepository,
  InMemoryShiftRepository,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';
import {
  InMemoryWorkdayQueries,
  InMemoryWorkdayRepository,
  InMemoryWorkdayStore,
} from '../../infrastructure/in-memory/in-memory-workday.store';
import type { WorkdayEmployee } from '../ports/workday-employee-directory';

import { RecalculateWorkdays } from './recalculate-workdays.command';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const SITE = '00000000-0000-4000-8000-0000000000d1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000f1' as DeviceId;
const SHIFT_A = '00000000-0000-4000-8000-0000000000a1' as ShiftId;
const SHIFT_B = '00000000-0000-4000-8000-0000000000a2' as ShiftId;
const RFC = 'GOMA850101AB1';
const NOW = new Date('2026-12-01T12:00:00Z');

const OFFICE: ShiftDay = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const AFTERNOON: ShiftDay = { type: 'WORK', start: '14:00', end: '22:00', mealBreakMinutes: 0 };

/** Instante UTC de la hora local de Cancún (UTC−5 fijo). */
function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00-05:00`);
}

let punchCounter = 0;
function punch(pin: string, date: string, time: string): Punch {
  punchCounter += 1;
  return Punch.restore(`punch-${punchCounter}` as PunchId, {
    deviceId: DEVICE,
    pin,
    deviceLocalTime: `${date} ${time}:00`,
    occurredAt: at(date, time),
    status: '0',
    verifyMode: '1',
    receivedAt: NOW,
  });
}

function buildShift(id: ShiftId, name: string, day: ShiftDay, tolerance = 10): Shift {
  const created = Shift.create({
    id,
    companyId: COMPANY,
    name,
    cycleStartDate: '2026-10-05',
    toleranceMinutes: tolerance,
    days: [day],
    now: NOW,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

async function setUp(
  overrides: { employee?: Partial<WorkdayEmployee> | null; siteMissing?: boolean } = {},
) {
  const shiftStore = new InMemoryShiftStore();
  const attendanceStore = new InMemoryAttendanceStore();
  const workdayStore = new InMemoryWorkdayStore();
  const shiftRepository = new InMemoryShiftRepository(shiftStore);
  await shiftRepository.add(buildShift(SHIFT_A, 'Oficina', OFFICE));
  await shiftRepository.add(buildShift(SHIFT_B, 'Tarde', AFTERNOON));
  const assignments = new InMemoryShiftAssignmentRepository(shiftStore);
  const punches = new InMemoryPunchRepository(attendanceStore);
  const inner = new InMemoryWorkdayRepository(workdayStore);

  const findByIdCalls: string[] = [];
  const countingShifts: ShiftRepository = {
    findById: (id) => {
      findByIdCalls.push(id);
      return shiftRepository.findById(id);
    },
    add: (shift) => shiftRepository.add(shift),
  };
  /** Orden de transacción, candado y escritura, para probar que se serializa. */
  const txEvents: string[] = [];
  const replaceCalls: {
    employeeId: string;
    dates: readonly string[];
    workdays: readonly Workday[];
  }[] = [];
  const workdayRepository: WorkdayRepository = {
    replaceDates: (employeeId, dates, workdays) => {
      replaceCalls.push({ employeeId, dates, workdays });
      txEvents.push('replace');
      return inner.replaceDates(employeeId, dates, workdays);
    },
    lockEmployee: (employeeId) => {
      txEvents.push(`lock:${employeeId}`);
      return inner.lockEmployee(employeeId);
    },
  };

  const employee: { current: WorkdayEmployee | null } = {
    current:
      overrides.employee === null
        ? null
        : {
            id: EMPLOYEE,
            companyId: COMPANY,
            active: true,
            rfc: RFC,
            siteId: SITE,
            hireDate: '2026-01-10',
            terminationDate: null,
            ...overrides.employee,
          },
  };
  const clock = new FixedClock(NOW);
  const command = new RecalculateWorkdays({
    workdayEmployeeDirectory: { find: () => Promise.resolve(employee.current) },
    deviceSiteDirectory: {
      find: () =>
        Promise.resolve(
          overrides.siteMissing ? null : { id: SITE, timeZone: 'America/Cancun', active: true },
        ),
    },
    shiftAssignmentRepository: assignments,
    shiftRepository: countingShifts,
    punchRepository: punches,
    workdayRepository,
    transactionRunner: {
      run: async (work) => {
        txEvents.push('begin');
        try {
          return await work();
        } finally {
          txEvents.push('end');
        }
      },
    },
    clock,
  });

  const assign = (effectiveFrom: string, shiftId: ShiftId) =>
    assignments.put({
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      shiftId,
      effectiveFrom,
      assignedAt: NOW,
      assignedBy: USER,
    });
  const addPunches = (...list: Punch[]) => punches.saveNew(list);
  const list = (from: string, to: string) =>
    new InMemoryWorkdayQueries(workdayStore, shiftStore).listByEmployee(EMPLOYEE, from, to);

  return {
    command,
    employee,
    clock,
    assign,
    addPunches,
    list,
    workdayStore,
    findByIdCalls,
    replaceCalls,
    txEvents,
  };
}

const input = { companyId: COMPANY, employeeId: EMPLOYEE, from: '2026-10-05', to: '2026-10-11' };

describe('RecalculateWorkdays', () => {
  // Plan attendance-asistencia-diaria/003 (revisión del 002, Low-2): recálculos concurrentes del
  // mismo colaborador se serializan con un candado dentro de la transacción.
  describe('serialización por colaborador', () => {
    it('abre la transacción, toma el candado del colaborador y solo después escribe', async () => {
      const { command, txEvents } = await setUp();

      const result = await command.execute(input);

      expect(result.ok).toBe(true);
      expect(txEvents).toEqual(['begin', `lock:${EMPLOYEE}`, 'replace', 'end']);
    });

    it('los errores de validación ocurren antes de la transacción: no abre ni bloquea', async () => {
      const missing = await setUp({ employee: null });
      const badRange = await setUp();

      await missing.command.execute(input);
      await badRange.command.execute({ ...input, from: '2026-10-11', to: '2026-10-05' });

      expect(missing.txEvents).toEqual([]);
      expect(badRange.txEvents).toEqual([]);
    });

    it('cierra la transacción aunque el cálculo falle (turno asignado inexistente)', async () => {
      const { command, assign, txEvents } = await setUp();
      await assign('2026-10-05', '00000000-0000-4000-8000-0000000000ff' as ShiftId);

      await expect(command.execute(input)).rejects.toThrow('asignado no existe');

      expect(txEvents).toEqual(['begin', `lock:${EMPLOYEE}`, 'end']);
    });
  });

  describe('errores, en orden', () => {
    it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
      const { command } = await setUp({ employee: null });

      const result = await command.execute(input);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('colaborador de otra empresa: EMPLOYEE_NOT_FOUND y no escribe', async () => {
      const { command, replaceCalls } = await setUp({ employee: { companyId: OTHER_COMPANY } });

      const result = await command.execute(input);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
      expect(replaceCalls).toEqual([]);
    });

    it('desvinculado sin fecha de baja: EMPLOYEE_INACTIVE, aunque además le falten RFC y sede', async () => {
      const { command, replaceCalls } = await setUp({
        employee: { active: false, terminationDate: null, rfc: null, siteId: null },
      });

      const result = await command.execute(input);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
      expect(replaceCalls).toEqual([]);
    });

    it('sin RFC: EMPLOYEE_WITHOUT_RFC antes que la falta de sede, con el id del colaborador', async () => {
      const { command } = await setUp({ employee: { rfc: null, siteId: null } });

      const result = await command.execute(input);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_WITHOUT_RFC');
      expect(!result.ok && result.error.details).toEqual({ employeeId: EMPLOYEE });
    });

    it('sin sede: EMPLOYEE_WITHOUT_SITE', async () => {
      const { command } = await setUp({ employee: { siteId: null } });

      const result = await command.execute(input);

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_WITHOUT_SITE');
      expect(!result.ok && result.error.details).toEqual({ employeeId: EMPLOYEE });
    });

    it('sede inexistente: SITE_NOT_FOUND antes de validar el rango', async () => {
      const { command } = await setUp({ siteMissing: true });

      const result = await command.execute({ ...input, from: '2026-10-11', to: '2026-10-05' });

      expect(!result.ok && result.error.code).toBe('SITE_NOT_FOUND');
    });

    it('rango invertido: INVALID_VALUE y no escribe', async () => {
      const { command, replaceCalls } = await setUp();

      const result = await command.execute({ ...input, from: '2026-10-11', to: '2026-10-05' });

      expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
      expect(replaceCalls).toEqual([]);
    });

    it('rango de 63 días: INVALID_VALUE; de 62 días: se procesa', async () => {
      const { command } = await setUp();

      const tooLong = await command.execute({ ...input, from: '2026-10-01', to: '2026-12-02' });
      const limit = await command.execute({ ...input, from: '2026-10-01', to: '2026-12-01' });

      expect(!tooLong.ok && tooLong.error.code).toBe('INVALID_VALUE');
      expect(limit.ok && limit.value.recalculatedDates + limit.value.pendingDates.length).toBe(62);
    });
  });

  describe('cálculo y guardado', () => {
    it('semana de oficina: cuenta fechas y jornadas, y guarda lo calculado', async () => {
      const { command, assign, addPunches, list } = await setUp();
      await assign('2026-10-05', SHIFT_A);
      await addPunches(
        punch(RFC, '2026-10-05', '08:00'),
        punch(RFC, '2026-10-05', '18:00'),
        punch(RFC, '2026-10-08', '09:00'),
      );

      const result = await command.execute(input);

      // Con turno de un solo día WORK, los siete días son laborables.
      expect(result.ok && result.value).toEqual({
        recalculatedDates: 7,
        storedWorkdays: 7,
        pendingDates: [],
      });
      const stored = await list('2026-10-05', '2026-10-11');
      expect(stored.map((row) => [row.date, row.status, row.shiftName])).toEqual([
        ['2026-10-05', 'ATTENDED', 'Oficina'],
        ['2026-10-06', 'ABSENT_NO_PUNCHES', 'Oficina'],
        ['2026-10-07', 'ABSENT_NO_PUNCHES', 'Oficina'],
        ['2026-10-08', 'ABSENT_SINGLE_PUNCH', 'Oficina'],
        ['2026-10-09', 'ABSENT_NO_PUNCHES', 'Oficina'],
        ['2026-10-10', 'ABSENT_NO_PUNCHES', 'Oficina'],
        ['2026-10-11', 'ABSENT_NO_PUNCHES', 'Oficina'],
      ]);
      expect(stored[0]).toMatchObject({ workedMinutes: 540, overtimeMinutes: 60 });
    });

    it('las marcaciones de otro PIN no se atribuyen al colaborador', async () => {
      const { command, assign, addPunches, list } = await setUp();
      await assign('2026-10-05', SHIFT_A);
      await addPunches(
        punch('OTRO850101XX1', '2026-10-05', '09:00'),
        punch('OTRO850101XX1', '2026-10-05', '18:00'),
      );

      await command.execute(input);

      const [monday] = await list('2026-10-05', '2026-10-05');
      expect(monday).toMatchObject({ status: 'ABSENT_NO_PUNCHES', punchCount: 0 });
    });

    it('sin turno asignado: todas las fechas se cierran pero no se guarda ninguna jornada', async () => {
      const { command, replaceCalls } = await setUp();

      const result = await command.execute(input);

      expect(result.ok && result.value).toEqual({
        recalculatedDates: 7,
        storedWorkdays: 0,
        pendingDates: [],
      });
      expect(replaceCalls).toHaveLength(1);
    });

    it('un cambio de turno a mitad del rango aplica el nuevo desde su fecha de vigencia, inclusive', async () => {
      const { command, assign, list } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      await assign('2026-10-07', SHIFT_B);

      await command.execute({ ...input, to: '2026-10-08' });

      const rows = await list('2026-10-05', '2026-10-08');
      expect(rows.map((row) => row.shiftName)).toEqual(['Oficina', 'Oficina', 'Tarde', 'Tarde']);
      expect(rows[1]?.scheduledStartAt).toBe(at('2026-10-06', '09:00').toISOString());
      expect(rows[2]?.scheduledStartAt).toBe(at('2026-10-07', '14:00').toISOString());
    });

    it('una asignación posterior al rango no se aplica; una anterior a la primera fecha sí', async () => {
      const { command, assign, list } = await setUp();
      await assign('2026-01-05', SHIFT_A);
      await assign('2026-10-20', SHIFT_B);

      await command.execute(input);

      const rows = await list('2026-10-05', '2026-10-11');
      expect(rows.every((row) => row.shiftName === 'Oficina')).toBe(true);
    });

    it('fechas anteriores a la primera asignación no tienen jornada', async () => {
      const { command, assign, list } = await setUp();
      await assign('2026-10-07', SHIFT_A);

      const result = await command.execute(input);

      expect(result.ok && result.value.storedWorkdays).toBe(5);
      expect((await list('2026-10-05', '2026-10-11'))[0]?.date).toBe('2026-10-07');
    });

    it('carga cada turno una sola vez, por distinto que sea el número de días', async () => {
      const { command, assign, findByIdCalls } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      await assign('2026-10-07', SHIFT_B);

      await command.execute(input);

      expect([...findByIdCalls].sort()).toEqual([SHIFT_A, SHIFT_B]);
    });

    it('un turno asignado que ya no existe es corrupción: lanza en vez de devolver un error de negocio', async () => {
      const { command, assign } = await setUp();
      await assign('2026-10-01', '00000000-0000-4000-8000-0000000000ff' as ShiftId);

      await expect(command.execute(input)).rejects.toThrow('asignado no existe');
    });

    it('reemplaza solo las fechas cerradas con las jornadas calculadas, en una sola llamada', async () => {
      const { command, assign, clock, replaceCalls } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      // Miércoles a mediodía: cerradas lunes y martes; miércoles y jueves siguen abiertas.
      clock.set(at('2026-10-07', '12:00'));

      const result = await command.execute({ ...input, to: '2026-10-08' });

      expect(result.ok && result.value).toEqual({
        recalculatedDates: 2,
        storedWorkdays: 2,
        pendingDates: ['2026-10-07', '2026-10-08'],
      });
      expect(replaceCalls).toHaveLength(1);
      expect(replaceCalls[0]?.employeeId).toBe(EMPLOYEE);
      expect(replaceCalls[0]?.dates).toEqual(['2026-10-05', '2026-10-06']);
      expect(replaceCalls[0]?.workdays.map((workday) => workday.date)).toEqual([
        '2026-10-05',
        '2026-10-06',
      ]);
    });

    it('una fecha pendiente conserva lo que ya tenía guardado', async () => {
      const { command, assign, clock, workdayStore, list } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      await command.execute({ ...input, to: '2026-10-08' });
      const before = await list('2026-10-08', '2026-10-08');
      clock.set(at('2026-10-07', '12:00'));

      await command.execute({ ...input, to: '2026-10-08' });

      expect(await list('2026-10-08', '2026-10-08')).toEqual(before);
      expect(workdayStore.workdays.size).toBe(4);
    });

    it('recalcular de nuevo reemplaza las filas: sin duplicados y con la marcación nueva', async () => {
      const { command, assign, addPunches, list, workdayStore } = await setUp();
      await assign('2026-10-05', SHIFT_A);
      await addPunches(punch(RFC, '2026-10-05', '09:00'));
      await command.execute(input);
      expect((await list('2026-10-05', '2026-10-05'))[0]?.status).toBe('ABSENT_SINGLE_PUNCH');
      const size = workdayStore.workdays.size;

      await addPunches(punch(RFC, '2026-10-05', '19:00'));
      await command.execute(input);

      expect(workdayStore.workdays.size).toBe(size);
      expect((await list('2026-10-05', '2026-10-05'))[0]).toMatchObject({
        status: 'ATTENDED',
        punchCount: 2,
        workedMinutes: 540,
      });
    });

    it('al recalcular se borran las jornadas que ya no corresponden (p. ej. antes de una nueva contratación)', async () => {
      const { command, assign, employee, list } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      await command.execute(input);
      expect(await list('2026-10-05', '2026-10-05')).toHaveLength(1);
      if (!employee.current) throw new Error('colaborador de prueba');
      employee.current = { ...employee.current, hireDate: '2026-10-07' };

      await command.execute(input);

      const dates = (await list('2026-10-05', '2026-10-11')).map((row) => row.date);
      expect(dates).toEqual(['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11']);
    });

    it('no toca las jornadas fuera de las fechas recalculadas', async () => {
      const { command, assign, workdayStore } = await setUp();
      await assign('2026-10-01', SHIFT_A);
      await command.execute({ ...input, from: '2026-10-12', to: '2026-10-12' });
      const outside = workdayStore.workdays.get(`${EMPLOYEE}|2026-10-12`);

      await command.execute(input);

      expect(workdayStore.workdays.get(`${EMPLOYEE}|2026-10-12`)).toEqual(outside);
    });
  });

  describe('colaborador desvinculado con fecha de baja', () => {
    it('se puede recalcular y las jornadas llegan solo hasta la baja, inclusive', async () => {
      const { command, assign, list } = await setUp({
        employee: { active: false, terminationDate: '2026-10-07' },
      });
      await assign('2026-10-01', SHIFT_A);

      const result = await command.execute(input);

      expect(result.ok && result.value).toEqual({
        recalculatedDates: 7,
        storedWorkdays: 3,
        pendingDates: [],
      });
      expect((await list('2026-10-05', '2026-10-11')).map((row) => row.date)).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
      ]);
    });
  });
});
