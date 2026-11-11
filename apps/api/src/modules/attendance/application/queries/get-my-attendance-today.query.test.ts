import { describe, expect, it } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import type { DeviceId } from '../../domain/device';
import { Punch, type PunchId } from '../../domain/punch';
import { Shift, type ShiftDay, type ShiftId } from '../../domain/shift';
import {
  InMemoryAttendanceStore,
  InMemoryPunchRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';
import {
  InMemoryShiftAssignmentRepository,
  InMemoryShiftRepository,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';
import type { WorkdayEmployee } from '../ports/workday-employee-directory';

import { GetMyAttendanceToday } from './get-my-attendance-today.query';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const NO_SITE_EMPLOYEE = '00000000-0000-4000-8000-0000000000e3';
const GHOST_SITE_EMPLOYEE = '00000000-0000-4000-8000-0000000000e4';
const SITE = '00000000-0000-4000-8000-0000000000b1';
const GHOST_SITE = '00000000-0000-4000-8000-0000000000b9';
const SHIFT = '00000000-0000-4000-8000-0000000000a1' as ShiftId;
const DEVICE = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const RFC = 'GOMA850101AB1';

const WORK: ShiftDay = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const REST: ShiftDay = { type: 'REST' };
/** Lunes a viernes; el ciclo arranca el lunes 2026-10-05 (el 10 de noviembre es martes). */
const OFFICE_DAYS = [WORK, WORK, WORK, WORK, WORK, REST, REST];
const NIGHT_DAYS: ShiftDay[] = [
  { type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 30 },
];

// Cancún es UTC−5: martes 10 de noviembre de 2026, 10:00 hora local.
const TUESDAY = '2026-11-10T15:00:00Z';
const SUNDAY = '2026-11-15T15:00:00Z';

interface Options {
  now: string;
  days?: ShiftDay[] | null;
  effectiveFrom?: string;
  employee?: Partial<WorkdayEmployee>;
  punches?: { pin: string; at: string }[];
  /** Asigna un turno que no existe en el repositorio (corrupción). */
  orphanAssignment?: boolean;
}

async function setUp(options: Options) {
  const attendance = new InMemoryAttendanceStore();
  const shifts = new InMemoryShiftStore();
  const shiftRepository = new InMemoryShiftRepository(shifts);
  const shiftAssignmentRepository = new InMemoryShiftAssignmentRepository(shifts);
  const punchRepository = new InMemoryPunchRepository(attendance);

  const days = options.days === undefined ? OFFICE_DAYS : options.days;
  if (days) {
    const created = Shift.create({
      id: SHIFT,
      companyId: COMPANY,
      name: 'Oficina',
      cycleStartDate: '2026-10-05',
      toleranceMinutes: 10,
      days,
      now: new Date('2026-01-01T00:00:00Z'),
    });
    if (!created.ok) throw created.error;
    await shiftRepository.add(created.value);
  }
  if (days || options.orphanAssignment) {
    await shiftAssignmentRepository.put({
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      shiftId: SHIFT,
      effectiveFrom: options.effectiveFrom ?? '2026-10-05',
      assignedAt: new Date('2026-01-01T00:00:00Z'),
      assignedBy: 'test',
    });
  }
  await punchRepository.saveNew(
    (options.punches ?? []).map((punch, index) =>
      Punch.restore(`p${index}` as PunchId, {
        deviceId: DEVICE,
        pin: punch.pin,
        deviceLocalTime: `n${index}`,
        occurredAt: new Date(punch.at),
        status: '0',
        verifyMode: '1',
        receivedAt: new Date(punch.at),
      }),
    ),
  );

  const employees = new Map<string, WorkdayEmployee>([
    [
      EMPLOYEE,
      {
        id: EMPLOYEE,
        companyId: COMPANY,
        active: true,
        rfc: RFC,
        siteId: SITE,
        hireDate: '2026-01-10',
        terminationDate: null,
        ...options.employee,
      },
    ],
    [
      NO_SITE_EMPLOYEE,
      {
        id: NO_SITE_EMPLOYEE,
        companyId: COMPANY,
        active: true,
        rfc: RFC,
        siteId: null,
        hireDate: '2026-01-10',
        terminationDate: null,
      },
    ],
    [
      GHOST_SITE_EMPLOYEE,
      {
        id: GHOST_SITE_EMPLOYEE,
        companyId: COMPANY,
        active: true,
        rfc: RFC,
        siteId: GHOST_SITE,
        hireDate: '2026-01-10',
        terminationDate: null,
      },
    ],
  ]);

  return new GetMyAttendanceToday({
    workdayEmployeeDirectory: { find: (id) => Promise.resolve(employees.get(id) ?? null) },
    deviceSiteDirectory: {
      find: (id) =>
        Promise.resolve(id === SITE ? { id, timeZone: 'America/Cancun', active: true } : null),
    },
    shiftAssignmentRepository,
    shiftRepository,
    punchRepository,
    clock: new FixedClock(new Date(options.now)),
  });
}

describe('GetMyAttendanceToday', () => {
  describe('acceso y datos del colaborador', () => {
    it('cuenta sin colaborador vinculado: ACCOUNT_NOT_LINKED', async () => {
      const result = await (await setUp({ now: TUESDAY })).execute({ employeeId: null });

      expect(!result.ok && result.error.code).toBe('ACCOUNT_NOT_LINKED');
    });

    it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
      const result = await (
        await setUp({ now: TUESDAY })
      ).execute({ employeeId: '00000000-0000-4000-8000-0000000000ff' });

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('colaborador sin sede: EMPLOYEE_WITHOUT_SITE', async () => {
      const result = await (
        await setUp({ now: TUESDAY })
      ).execute({ employeeId: NO_SITE_EMPLOYEE });

      expect(!result.ok && result.error.code).toBe('EMPLOYEE_WITHOUT_SITE');
    });

    it('sede que ya no existe: SITE_NOT_FOUND', async () => {
      const result = await (
        await setUp({ now: TUESDAY })
      ).execute({ employeeId: GHOST_SITE_EMPLOYEE });

      expect(!result.ok && result.error.code).toBe('SITE_NOT_FOUND');
    });
  });

  describe('día laborable', () => {
    it('devuelve la fecha local, la zona y el turno con entrada y salida programadas en UTC', async () => {
      const result = await (await setUp({ now: TUESDAY })).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value).toEqual({
        date: '2026-11-10',
        timeZone: 'America/Cancun',
        shift: {
          id: SHIFT,
          name: 'Oficina',
          day: {
            type: 'WORK',
            scheduledStartAt: '2026-11-10T14:00:00.000Z',
            scheduledEndAt: '2026-11-10T23:00:00.000Z',
            scheduledMinutes: 480,
            mealBreakMinutes: 60,
            toleranceMinutes: 10,
          },
        },
        punches: [],
      });
    });

    it('la fecha de hoy sale de la zona de la sede, no de UTC', async () => {
      // 02:00 UTC del 11 de noviembre = 21:00 del 10 en Cancún.
      const result = await (
        await setUp({ now: '2026-11-11T02:00:00Z' })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.date).toBe('2026-11-10');
    });

    it('lista las marcaciones de la ventana de hoy en orden ascendente y deja fuera las de ayer y mañana', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          punches: [
            { pin: RFC, at: '2026-11-10T22:30:00Z' }, // 17:30 local: salida
            { pin: RFC, at: '2026-11-10T13:56:00Z' }, // 08:56 local: entrada
            { pin: RFC, at: '2026-11-09T23:05:00Z' }, // ayer 18:05 local
            { pin: RFC, at: '2026-11-10T09:59:00Z' }, // 04:59 local: antes de la ventana
            { pin: RFC, at: '2026-11-11T10:00:00Z' }, // 05:00 local de mañana: ventana siguiente
          ],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.punches).toEqual([
        '2026-11-10T13:56:00.000Z',
        '2026-11-10T22:30:00.000Z',
      ]);
    });

    it('solo muestra marcaciones del RFC del propio colaborador', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          punches: [
            { pin: 'OTRO850101AB1', at: '2026-11-10T14:00:00Z' },
            { pin: RFC, at: '2026-11-10T14:05:00Z' },
          ],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.punches).toEqual(['2026-11-10T14:05:00.000Z']);
    });

    it('sin RFC no hay a quién atribuir marcaciones: lista vacía, pero el turno se muestra', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          employee: { rfc: null },
          punches: [{ pin: RFC, at: '2026-11-10T14:00:00Z' }],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.punches).toEqual([]);
      expect(result.ok && result.value.shift?.day.type).toBe('WORK');
    });
  });

  describe('turno nocturno 22:00–06:00', () => {
    it('la salida programada cae al día siguiente y la ventana va de las 18:00 de hoy a las 18:00 de mañana', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          days: NIGHT_DAYS,
          punches: [
            { pin: RFC, at: '2026-11-10T22:30:00Z' }, // 17:30 local: antes de la ventana
            { pin: RFC, at: '2026-11-11T03:10:00Z' }, // 22:10 local: entrada
            { pin: RFC, at: '2026-11-11T11:05:00Z' }, // 06:05 local de mañana: salida
            { pin: RFC, at: '2026-11-11T23:00:00Z' }, // 18:00 local de mañana: ventana siguiente
          ],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.shift?.day).toEqual({
        type: 'WORK',
        scheduledStartAt: '2026-11-11T03:00:00.000Z',
        scheduledEndAt: '2026-11-11T11:00:00.000Z',
        scheduledMinutes: 450, // 8 h brutas menos 30 min de comida
        mealBreakMinutes: 30,
        toleranceMinutes: 10,
      });
      expect(result.ok && result.value.punches).toEqual([
        '2026-11-11T03:10:00.000Z',
        '2026-11-11T11:05:00.000Z',
      ]);
    });
  });

  describe('día de descanso', () => {
    it('devuelve day REST con el nombre del turno y las marcaciones de hoy', async () => {
      const result = await (
        await setUp({ now: SUNDAY, punches: [{ pin: RFC, at: '2026-11-15T16:00:00Z' }] })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value).toEqual({
        date: '2026-11-15',
        timeZone: 'America/Cancun',
        shift: { id: SHIFT, name: 'Oficina', day: { type: 'REST' } },
        punches: ['2026-11-15T16:00:00.000Z'],
      });
    });
  });

  describe('sin turno que aplique', () => {
    it('sin ninguna asignación: shift null y sin marcaciones', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          days: null,
          punches: [{ pin: RFC, at: '2026-11-10T14:00:00Z' }],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value).toEqual({
        date: '2026-11-10',
        timeZone: 'America/Cancun',
        shift: null,
        punches: [],
      });
    });

    it('asignación que empieza mañana: hoy no tiene turno', async () => {
      const result = await (
        await setUp({ now: TUESDAY, effectiveFrom: '2026-11-11' })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.shift).toBeNull();
    });

    it('turno asignado inexistente: error inesperado (corrupción), no un error de negocio', async () => {
      const use = await setUp({ now: TUESDAY, days: null, orphanAssignment: true });

      await expect(use.execute({ employeeId: EMPLOYEE })).rejects.toThrow(/no existe/);
    });
  });

  describe('fuera de la contratación', () => {
    it('antes de la fecha de ingreso: shift null y sin marcaciones aunque haya turno', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          employee: { hireDate: '2026-11-11' },
          punches: [{ pin: RFC, at: '2026-11-10T14:00:00Z' }],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value).toEqual({
        date: '2026-11-10',
        timeZone: 'America/Cancun',
        shift: null,
        punches: [],
      });
    });

    it('el día de ingreso ya muestra el turno', async () => {
      const result = await (
        await setUp({ now: TUESDAY, employee: { hireDate: '2026-11-10' } })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.shift?.name).toBe('Oficina');
    });

    it('después de la baja: shift null y sin marcaciones', async () => {
      const result = await (
        await setUp({
          now: TUESDAY,
          employee: { terminationDate: '2026-11-09' },
          punches: [{ pin: RFC, at: '2026-11-10T14:00:00Z' }],
        })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.shift).toBeNull();
      expect(result.ok && result.value.punches).toEqual([]);
    });

    it('el día de la baja todavía muestra el turno (inclusive)', async () => {
      const result = await (
        await setUp({ now: TUESDAY, employee: { terminationDate: '2026-11-10' } })
      ).execute({ employeeId: EMPLOYEE });

      expect(result.ok && result.value.shift?.name).toBe('Oficina');
    });
  });
});
