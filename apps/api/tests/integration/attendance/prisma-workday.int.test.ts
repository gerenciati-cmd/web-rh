import { describe, expect, it } from 'vitest';

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
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

// El TRUNCATE ... CASCADE de support.ts encadena las tablas por FK; se listan todas las que se ensucian.
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
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-12-01T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const USER = '00000000-0000-4000-8000-0000000000b1';

async function savedShift(name: string): Promise<Shift> {
  const created = Shift.create({
    id: ids.next() as ShiftId,
    companyId: COMPANY,
    name,
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
    firstPunchAt: new Date(`${date}T13:00:00Z`),
    lastPunchAt: new Date(`${date}T23:00:00Z`),
    punchCount: 2,
    lateMinutes: 0,
    workedMinutes: 540,
    overtimeMinutes: 60,
    calculatedAt: NOW,
    ...overrides,
  };
}

async function savedDevice(serialNumber: string): Promise<Device> {
  const created = Device.register({
    id: ids.next() as DeviceId,
    serialNumber,
    name: `Equipo ${serialNumber}`,
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await devices.add(created.value);
  if (!saved.ok) throw saved.error;
  return created.value;
}

function punch(device: Device, pin: string, deviceTime: string): Punch {
  const created = Punch.fromDevice({
    id: ids.next() as PunchId,
    deviceId: device.id,
    timeZone: device.timeZone,
    pin,
    deviceTime,
    status: '0',
    verifyMode: '1',
    receivedAt: NOW,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

function assignment(shift: Shift, effectiveFrom: string, employeeId = EMPLOYEE) {
  return {
    employeeId,
    companyId: COMPANY,
    shiftId: shift.id,
    effectiveFrom,
    assignedAt: NOW,
    assignedBy: USER,
  };
}

describe('PrismaWorkdayRepository.replaceDates', () => {
  it('inserta las jornadas con la fecha como DATE y los instantes intactos', async () => {
    const shift = await savedShift('Oficina');

    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);

    const rows = await database.client.$queryRawUnsafe<{ date: string; status: string }[]>(
      `SELECT date::text AS date, status FROM attendance.workdays`,
    );
    expect(rows).toEqual([{ date: '2026-10-05', status: 'ATTENDED' }]);
    const [stored] = await queries.listByEmployee(EMPLOYEE, '2026-10-05', '2026-10-05');
    expect(stored).toEqual({
      date: '2026-10-05',
      shiftId: shift.id,
      shiftName: 'Oficina',
      status: 'ATTENDED',
      scheduledStartAt: '2026-10-05T14:00:00.000Z',
      scheduledEndAt: '2026-10-05T23:00:00.000Z',
      scheduledMinutes: 480,
      firstPunchAt: '2026-10-05T13:00:00.000Z',
      lastPunchAt: '2026-10-05T23:00:00.000Z',
      punchCount: 2,
      lateMinutes: 0,
      workedMinutes: 540,
      overtimeMinutes: 60,
      calculatedAt: NOW.toISOString(),
    });
  });

  it('guarda los instantes nulos de un descanso trabajado y de una falta', async () => {
    const shift = await savedShift('Oficina');

    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-10-10', '2026-10-09'],
      [
        workday(shift, '2026-10-10', {
          status: 'REST_WORKED',
          scheduledStartAt: null,
          scheduledEndAt: null,
          scheduledMinutes: 0,
        }),
        workday(shift, '2026-10-09', {
          status: 'ABSENT_NO_PUNCHES',
          firstPunchAt: null,
          lastPunchAt: null,
          punchCount: 0,
        }),
      ],
    );

    const rows = await queries.listByEmployee(EMPLOYEE, '2026-10-09', '2026-10-10');
    expect(rows[0]).toMatchObject({
      status: 'ABSENT_NO_PUNCHES',
      firstPunchAt: null,
      lastPunchAt: null,
    });
    expect(rows[1]).toMatchObject({
      status: 'REST_WORKED',
      scheduledStartAt: null,
      scheduledEndAt: null,
    });
  });

  it('reemplaza la fila de la misma fecha: una sola fila con los valores nuevos', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);

    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-10-05'],
      [
        workday(shift, '2026-10-05', {
          status: 'ABSENT_SINGLE_PUNCH',
          punchCount: 1,
          workedMinutes: 0,
        }),
      ],
    );

    expect(await database.client.attendanceWorkday.count()).toBe(1);
    const [row] = await queries.listByEmployee(EMPLOYEE, '2026-10-05', '2026-10-05');
    expect(row).toMatchObject({ status: 'ABSENT_SINGLE_PUNCH', punchCount: 1, workedMinutes: 0 });
  });

  it('borra las fechas recalculadas que ya no tienen jornada, sin tocar otras fechas ni otros colaboradores', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-10-05', '2026-10-06', '2026-10-20'],
      [workday(shift, '2026-10-05'), workday(shift, '2026-10-06'), workday(shift, '2026-10-20')],
    );
    await workdays.replaceDates(
      OTHER_EMPLOYEE,
      ['2026-10-05'],
      [workday(shift, '2026-10-05', { employeeId: OTHER_EMPLOYEE })],
    );

    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-10-05', '2026-10-06'],
      [workday(shift, '2026-10-06')],
    );

    const mine = await queries.listByEmployee(EMPLOYEE, '2026-10-01', '2026-10-31');
    expect(mine.map((row) => row.date)).toEqual(['2026-10-06', '2026-10-20']);
    expect(await queries.listByEmployee(OTHER_EMPLOYEE, '2026-10-01', '2026-10-31')).toHaveLength(
      1,
    );
  });

  it('con fechas pero sin jornadas, solo borra', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);

    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], []);

    expect(await database.client.attendanceWorkday.count()).toBe(0);
  });

  it('sin fechas no hace nada', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);

    await workdays.replaceDates(EMPLOYEE, [], []);

    expect(await database.client.attendanceWorkday.count()).toBe(1);
  });

  it('es atómico: si el insert falla (turno inexistente) el borrado se revierte', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);
    const ghost = {
      ...workday(shift, '2026-10-05'),
      shiftId: '00000000-0000-4000-8000-0000000000ff' as ShiftId,
    };

    await expect(workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [ghost])).rejects.toThrow();

    const [row] = await queries.listByEmployee(EMPLOYEE, '2026-10-05', '2026-10-05');
    expect(row).toMatchObject({ shiftId: shift.id, status: 'ATTENDED' });
  });
});

describe('PrismaWorkdayQueries.listByEmployee', () => {
  it('devuelve las jornadas del colaborador dentro del rango inclusivo, ascendentes, con el nombre del turno', async () => {
    const office = await savedShift('Oficina');
    const night = await savedShift('Noche');
    await workdays.replaceDates(
      EMPLOYEE,
      ['2026-10-07', '2026-10-05', '2026-10-09', '2026-10-04', '2026-10-12'],
      [
        workday(office, '2026-10-09'),
        workday(night, '2026-10-05'),
        workday(office, '2026-10-07'),
        workday(office, '2026-10-04'),
        workday(office, '2026-10-12'),
      ],
    );
    await workdays.replaceDates(
      OTHER_EMPLOYEE,
      ['2026-10-06'],
      [workday(office, '2026-10-06', { employeeId: OTHER_EMPLOYEE })],
    );

    const rows = await queries.listByEmployee(EMPLOYEE, '2026-10-05', '2026-10-09');

    expect(rows.map((row) => [row.date, row.shiftName])).toEqual([
      ['2026-10-05', 'Noche'],
      ['2026-10-07', 'Oficina'],
      ['2026-10-09', 'Oficina'],
    ]);
  });

  it('un colaborador sin jornadas devuelve una lista vacía', async () => {
    expect(await queries.listByEmployee(EMPLOYEE, '2026-10-01', '2026-10-31')).toEqual([]);
  });

  it('un estado desconocido en la columna es corrupción: falla en vez de devolverlo', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);
    await database.client.$executeRawUnsafe(
      `UPDATE attendance.workdays SET status = 'RARO' WHERE employee_id = '${EMPLOYEE}'::uuid AND date = '2026-10-05'`,
    );

    await expect(queries.listByEmployee(EMPLOYEE, '2026-10-05', '2026-10-05')).rejects.toThrow(
      'Estado de jornada desconocido: RARO',
    );
  });
});

describe('PrismaShiftAssignmentRepository.listByEmployee', () => {
  it('devuelve solo las asignaciones del colaborador, de la fecha más antigua a la más reciente', async () => {
    const first = await savedShift('Primero');
    const second = await savedShift('Segundo');
    await assignments.put(assignment(second, '2026-12-07'));
    await assignments.put(assignment(first, '2026-01-05'));
    await assignments.put(assignment(first, '2026-11-02'));
    await assignments.put(assignment(first, '2026-11-02', OTHER_EMPLOYEE));

    const list = await assignments.listByEmployee(EMPLOYEE);

    expect(list.map((item) => [item.effectiveFrom, item.shiftId])).toEqual([
      ['2026-01-05', first.id],
      ['2026-11-02', first.id],
      ['2026-12-07', second.id],
    ]);
    expect(list[0]).toEqual({
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      shiftId: first.id,
      effectiveFrom: '2026-01-05',
      assignedAt: NOW,
      assignedBy: USER,
    });
  });

  it('un colaborador sin asignaciones devuelve una lista vacía', async () => {
    expect(await assignments.listByEmployee(EMPLOYEE)).toEqual([]);
  });
});

describe('PrismaShiftAssignmentRepository.listAssignedEmployees', () => {
  it('devuelve cada colaborador con asignaciones una sola vez, con su empresa', async () => {
    const shift = await savedShift('Oficina');
    await assignments.put(assignment(shift, '2026-01-05'));
    await assignments.put(assignment(shift, '2026-11-02'));
    await assignments.put(assignment(shift, '2026-11-02', OTHER_EMPLOYEE));

    const list = await assignments.listAssignedEmployees();

    expect(list).toHaveLength(2);
    expect(list).toEqual(
      expect.arrayContaining([
        { employeeId: EMPLOYEE, companyId: COMPANY },
        { employeeId: OTHER_EMPLOYEE, companyId: COMPANY },
      ]),
    );
  });

  it('sin asignaciones devuelve una lista vacía', async () => {
    expect(await assignments.listAssignedEmployees()).toEqual([]);
  });
});

describe('PrismaPunchRepository.listInstants', () => {
  const PIN = 'GOMA850101AB1';

  it('incluye desde el límite inicial y excluye el final, ascendente', async () => {
    const device = await savedDevice('SNA001');
    await punches.saveNew([
      punch(device, PIN, '2026-10-05 18:00:00'),
      punch(device, PIN, '2026-10-05 08:00:00'),
      punch(device, PIN, '2026-10-05 12:00:00'),
      punch(device, PIN, '2026-10-05 07:59:59'),
    ]);

    const instants = await punches.listInstants(
      PIN,
      new Date('2026-10-05T13:00:00Z'),
      new Date('2026-10-05T23:00:00Z'),
    );

    // 08:00 local = 13:00Z (incluida); 18:00 local = 23:00Z (excluida).
    expect(instants.map((instant) => instant.toISOString())).toEqual([
      '2026-10-05T13:00:00.000Z',
      '2026-10-05T17:00:00.000Z',
    ]);
  });

  it('junta las marcaciones del mismo PIN de varios equipos, en orden global', async () => {
    const deviceA = await savedDevice('SNA001');
    const deviceB = await savedDevice('SNB001');
    await punches.saveNew([
      punch(deviceA, PIN, '2026-10-05 08:00:00'),
      punch(deviceA, PIN, '2026-10-05 18:00:00'),
    ]);
    await punches.saveNew([punch(deviceB, PIN, '2026-10-05 12:30:00')]);

    const instants = await punches.listInstants(
      PIN,
      new Date('2026-10-05T00:00:00Z'),
      new Date('2026-10-06T00:00:00Z'),
    );

    expect(instants.map((instant) => instant.toISOString())).toEqual([
      '2026-10-05T13:00:00.000Z',
      '2026-10-05T17:30:00.000Z',
      '2026-10-05T23:00:00.000Z',
    ]);
  });

  it('no trae las marcaciones de otro PIN', async () => {
    const device = await savedDevice('SNA001');
    await punches.saveNew([
      punch(device, PIN, '2026-10-05 08:00:00'),
      punch(device, 'OTRO850101XX1', '2026-10-05 09:00:00'),
    ]);

    const instants = await punches.listInstants(
      PIN,
      new Date('2026-10-05T00:00:00Z'),
      new Date('2026-10-06T00:00:00Z'),
    );

    expect(instants).toHaveLength(1);
  });

  it('un rango sin marcaciones devuelve una lista vacía', async () => {
    expect(
      await punches.listInstants(
        PIN,
        new Date('2026-10-05T00:00:00Z'),
        new Date('2026-10-06T00:00:00Z'),
      ),
    ).toEqual([]);
  });
});

describe('migración create_workdays', () => {
  it('crea la llave primaria (colaborador, fecha), los índices y el índice de marcaciones por PIN', async () => {
    const indexes = await database.client.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'attendance' AND tablename IN ('workdays', 'punches')
        ORDER BY indexname`,
    );

    const names = indexes.map((row) => row.indexname);
    expect(names).toContain('workdays_pkey');
    expect(names).toContain('workdays_company_id_date_idx');
    expect(names).toContain('workdays_shift_id_idx');
    expect(names).toContain('punches_pin_occurred_at_idx');
  });

  it('la llave primaria rechaza dos jornadas del mismo colaborador y fecha', async () => {
    const shift = await savedShift('Oficina');
    const row = workday(shift, '2026-10-05');
    const data = {
      ...row,
      date: new Date('2026-10-05T00:00:00Z'),
    };
    await database.client.attendanceWorkday.create({ data });

    await expect(database.client.attendanceWorkday.create({ data })).rejects.toThrow();
  });

  it('la FK al turno impide borrar un turno con jornadas guardadas', async () => {
    const shift = await savedShift('Oficina');
    await workdays.replaceDates(EMPLOYEE, ['2026-10-05'], [workday(shift, '2026-10-05')]);

    await expect(
      database.client.$executeRawUnsafe(
        `DELETE FROM attendance.shifts WHERE id = '${shift.id}'::uuid`,
      ),
    ).rejects.toThrow();
  });
});
