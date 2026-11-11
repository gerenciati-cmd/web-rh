import type { LatenessPeriod } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import type { DeviceId } from '../../domain/device';
import { Punch, type PunchId } from '../../domain/punch';
import { Shift, type ShiftId } from '../../domain/shift';
import {
  InMemoryAttendanceStore,
  InMemoryPunchRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';
import {
  InMemoryLatenessRuleRepository,
  InMemoryLatenessRuleStore,
} from '../../infrastructure/in-memory/in-memory-lateness-rule.store';
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

import { RecalculateWorkdays } from './recalculate-workdays.command';

/**
 * N retardos = 1 falta dentro del recálculo (plan attendance-asistencia-diaria/004, decisiones
 * 26-30). Turno diario de 09:00 a 18:00 con tolerancia de 10 min en Cancún (UTC−5), así que una
 * entrada a las 09:30 es un retardo de 30 min. Reloj: 2026-12-01, todo noviembre está cerrado.
 */
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const SITE = '00000000-0000-4000-8000-0000000000d1';
const USER = '00000000-0000-4000-8000-0000000000b1';
const DEVICE = '00000000-0000-4000-8000-0000000000f1' as DeviceId;
const SHIFT = '00000000-0000-4000-8000-0000000000a1' as ShiftId;
const RFC = 'GOMA850101AB1';
const NOW = new Date('2026-12-01T12:00:00Z');

const at = (date: string, time: string) => new Date(`${date}T${time}:00-05:00`);
const nov = (day: number) => `2026-11-${String(day).padStart(2, '0')}`;

let punchCounter = 0;
function punch(date: string, time: string): Punch {
  punchCounter += 1;
  return Punch.restore(`punch-${punchCounter}` as PunchId, {
    deviceId: DEVICE,
    pin: RFC,
    deviceLocalTime: `${date} ${time}:00`,
    occurredAt: at(date, time),
    status: '0',
    verifyMode: '1',
    receivedAt: NOW,
  });
}

async function setUp() {
  const shiftStore = new InMemoryShiftStore();
  const workdayStore = new InMemoryWorkdayStore();
  const latenessStore = new InMemoryLatenessRuleStore();
  const attendanceStore = new InMemoryAttendanceStore();
  const shifts = new InMemoryShiftRepository(shiftStore);
  const assignments = new InMemoryShiftAssignmentRepository(shiftStore);
  const punches = new InMemoryPunchRepository(attendanceStore);
  const rules = new InMemoryLatenessRuleRepository(latenessStore);
  const created = Shift.create({
    id: SHIFT,
    companyId: COMPANY,
    name: 'Oficina',
    cycleStartDate: '2026-10-05',
    toleranceMinutes: 10,
    days: [{ type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 }],
    now: NOW,
  });
  if (!created.ok) throw created.error;
  await shifts.add(created.value);
  await assignments.put({
    employeeId: EMPLOYEE,
    companyId: COMPANY,
    shiftId: SHIFT,
    effectiveFrom: '2026-10-05',
    assignedAt: NOW,
    assignedBy: USER,
  });

  const clock = new FixedClock(NOW);
  const command = new RecalculateWorkdays({
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
    latenessRuleRepository: rules,
    workdayRepository: new InMemoryWorkdayRepository(workdayStore),
    transactionRunner: { run: (work) => work() },
    clock,
  });

  const recalculate = (from: string, to: string) =>
    command.execute({ companyId: COMPANY, employeeId: EMPLOYEE, from, to });
  const list = async (from: string, to: string) =>
    (await new InMemoryWorkdayQueries(workdayStore, shiftStore).listByEmployee(
      EMPLOYEE,
      from,
      to,
    )) as { date: string; status: string; lateMinutes: number; calculatedAt: string }[];
  /** Retardo de 30 min: entra a las 09:30 y sale a las 18:00. */
  const late = (...days: number[]) =>
    punches.saveNew(days.flatMap((day) => [punch(nov(day), '09:30'), punch(nov(day), '18:00')]));
  const onTime = (...days: number[]) =>
    punches.saveNew(days.flatMap((day) => [punch(nov(day), '08:55'), punch(nov(day), '18:00')]));
  const setRule = (effectiveFrom: string, threshold: number, period: LatenessPeriod) =>
    rules.put({
      companyId: COMPANY,
      effectiveFrom,
      threshold,
      period,
      setAt: NOW,
      setBy: USER,
    });
  const lateness = async (from: string, to: string) =>
    (await list(from, to)).filter((row) => row.status === 'ABSENT_LATENESS').map((row) => row.date);

  return { recalculate, list, late, onTime, setRule, lateness, clock, workdayStore };
}

describe('RecalculateWorkdays: N retardos = 1 falta', () => {
  describe('regla por defecto (3 por quincena)', () => {
    it('el tercer retardo de la quincena se guarda como ABSENT_LATENESS con sus minutos de retardo', async () => {
      const { recalculate, late, list } = await setUp();
      await late(3, 4, 5);

      await recalculate(nov(1), nov(10));

      const rows = await list(nov(3), nov(5));
      expect(rows.map((row) => [row.date, row.status, row.lateMinutes])).toEqual([
        [nov(3), 'ATTENDED', 30],
        [nov(4), 'ATTENDED', 30],
        [nov(5), 'ABSENT_LATENESS', 30],
      ]);
    });

    it('con 7 retardos en la quincena, el 3.º y el 6.º son falta y el 7.º no se arrastra', async () => {
      const { recalculate, late, lateness, list } = await setUp();
      await late(2, 3, 4, 5, 6, 9, 10);

      await recalculate(nov(1), nov(15));

      expect(await lateness(nov(1), nov(15))).toEqual([nov(4), nov(9)]);
      expect((await list(nov(10), nov(10)))[0]?.status).toBe('ATTENDED');
    });

    it('el retardo siguiente a la falta no se arrastra a la quincena que sigue', async () => {
      const { recalculate, late, lateness } = await setUp();
      await late(2, 3, 4, 5, 16, 17);

      await recalculate(nov(1), nov(30));

      expect(await lateness(nov(1), nov(30))).toEqual([nov(4)]);
    });

    it('dos retardos no hacen falta', async () => {
      const { recalculate, late, lateness } = await setUp();
      await late(3, 4);

      await recalculate(nov(1), nov(15));

      expect(await lateness(nov(1), nov(15))).toEqual([]);
    });

    it('retardos de quincenas distintas no se suman (14, 15 y 16)', async () => {
      const { recalculate, late, lateness } = await setUp();
      await late(14, 15, 16);

      await recalculate(nov(1), nov(30));

      expect(await lateness(nov(1), nov(30))).toEqual([]);
    });

    it('las faltas por no marcar no cuentan como retardo', async () => {
      const { recalculate, late, lateness } = await setUp();
      // Solo hay marcaciones el 3 y el 4; el resto son ABSENT_NO_PUNCHES.
      await late(3, 4);

      await recalculate(nov(1), nov(15));

      expect(await lateness(nov(1), nov(15))).toEqual([]);
    });
  });

  describe('deshacer cuando un retardo desaparece', () => {
    it('un retardo anterior que llega a tiempo y se recalcula solo ese día devuelve la falta a ATTENDED', async () => {
      const { recalculate, late, onTime, list, lateness } = await setUp();
      await late(3, 4, 5);
      await recalculate(nov(1), nov(10));
      expect(await lateness(nov(3), nov(5))).toEqual([nov(5)]);

      await onTime(3);
      const result = await recalculate(nov(3), nov(3));

      // Solo se recalculó un día, pero se recontó todo el tramo.
      expect(result.ok && result.value).toMatchObject({ recalculatedDates: 1, storedWorkdays: 1 });
      const rows = await list(nov(3), nov(5));
      expect(rows.map((row) => [row.date, row.status, row.lateMinutes])).toEqual([
        [nov(3), 'ATTENDED', 0],
        [nov(4), 'ATTENDED', 30],
        [nov(5), 'ATTENDED', 30],
      ]);
    });

    it('recalcular de nuevo sin cambios conserva la falta y no duplica filas', async () => {
      const { recalculate, late, lateness, workdayStore } = await setUp();
      await late(3, 4, 5);
      await recalculate(nov(1), nov(10));
      const size = workdayStore.workdays.size;

      await recalculate(nov(1), nov(10));

      expect(await lateness(nov(1), nov(10))).toEqual([nov(5)]);
      expect(workdayStore.workdays.size).toBe(size);
    });
  });

  describe('rango que toca solo parte del tramo', () => {
    it('un día que se cierra después completa el bloque con los retardos ya guardados', async () => {
      const { recalculate, late, lateness } = await setUp();
      await late(3, 4, 5);
      await recalculate(nov(3), nov(4));
      expect(await lateness(nov(1), nov(15))).toEqual([]);

      const result = await recalculate(nov(5), nov(5));

      expect(await lateness(nov(1), nov(15))).toEqual([nov(5)]);
      // El resultado cuenta solo el rango recalculado, no los días recontados del tramo.
      expect(result.ok && result.value).toEqual({
        recalculatedDates: 1,
        storedWorkdays: 1,
        pendingDates: [],
      });
    });

    it('un día todavía abierto no entra a la cuenta; al cerrarse el día, la siguiente corrida lo convierte', async () => {
      const { recalculate, late, lateness, clock } = await setUp();
      await late(3, 4, 5);
      // Jueves 5 a mediodía: el 5 sigue abierto (su jornada termina a las 18:00).
      clock.set(at(nov(5), '12:00'));

      await recalculate(nov(3), nov(5));
      expect(await lateness(nov(1), nov(15))).toEqual([]);

      clock.set(at(nov(6), '12:00'));
      await recalculate(nov(3), nov(5));

      expect(await lateness(nov(1), nov(15))).toEqual([nov(5)]);
    });

    it('recalcular un rango que no es cerca del tramo no toca sus días guardados', async () => {
      const { recalculate, late, workdayStore } = await setUp();
      await late(3, 4, 5);
      await recalculate(nov(3), nov(5));
      const before = workdayStore.workdays.get(`${EMPLOYEE}|${nov(5)}`);

      await recalculate(nov(20), nov(21));

      expect(workdayStore.workdays.get(`${EMPLOYEE}|${nov(5)}`)).toEqual(before);
    });

    it('un rango que cruza dos quincenas recuenta cada una por separado y completa la segunda con lo guardado', async () => {
      const { recalculate, late, lateness } = await setUp();
      await late(13, 14, 15, 16, 17, 18);

      await recalculate(nov(13), nov(17));

      expect(await lateness(nov(1), nov(30))).toEqual([nov(15)]);
      await recalculate(nov(18), nov(18));
      expect(await lateness(nov(1), nov(30))).toEqual([nov(15), nov(18)]);
    });
  });

  describe('historial de reglas', () => {
    it('una regla vigente cambia N y periodo: 2 por semana convierte el segundo retardo de la semana', async () => {
      const { recalculate, late, setRule, lateness } = await setUp();
      await setRule(nov(1), 2, 'WEEK');
      await late(2, 3, 4);

      await recalculate(nov(1), nov(8));

      expect(await lateness(nov(1), nov(8))).toEqual([nov(3)]);
    });

    it('un periodo se corta en el cambio de regla: los retardos de antes y de después no se suman', async () => {
      const { recalculate, late, setRule, lateness } = await setUp();
      // Antes de la regla (quincena, N=3): 10 y 11. Después (semana, N=3 desde el 12): 12.
      await setRule(nov(12), 3, 'WEEK');
      await late(10, 11, 12);

      await recalculate(nov(10), nov(12));

      expect(await lateness(nov(1), nov(15))).toEqual([]);
    });

    it('dos reglas en el mismo rango: cada tramo usa su N', async () => {
      const { recalculate, late, setRule, lateness } = await setUp();
      await setRule(nov(12), 2, 'WEEK');
      // Tramo por defecto 1-11: retardos 9, 10 (2 < 3, ninguno). Tramo semanal 12-15: 12 y 13 con N=2.
      await late(9, 10, 12, 13);

      await recalculate(nov(9), nov(13));

      expect(await lateness(nov(1), nov(15))).toEqual([nov(13)]);
    });

    it('un tramo anterior a la regla conserva la regla que tenía: recalcularlo no usa la nueva', async () => {
      const { recalculate, late, setRule, lateness } = await setUp();
      await setRule(nov(12), 1, 'WEEK');
      await late(3, 4, 5);

      await recalculate(nov(1), nov(10));

      // Con N=1 los tres serían falta; rige la regla por defecto (N=3) hasta el 11.
      expect(await lateness(nov(1), nov(11))).toEqual([nov(5)]);
    });
  });

  describe('lo que no cambia', () => {
    it('sin retardos no hay faltas por retardos y el resultado sigue contando el rango', async () => {
      const { recalculate, onTime, lateness } = await setUp();
      await onTime(3, 4, 5);

      const result = await recalculate(nov(1), nov(10));

      expect(await lateness(nov(1), nov(10))).toEqual([]);
      expect(result.ok && result.value).toEqual({
        recalculatedDates: 10,
        storedWorkdays: 10,
        pendingDates: [],
      });
    });
  });
});
