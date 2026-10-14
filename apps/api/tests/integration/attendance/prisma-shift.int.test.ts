import { describe, expect, it } from 'vitest';

import { Shift, type ShiftDay, type ShiftId } from '@/modules/attendance/domain/shift';
import { PrismaShiftAssignmentRepository } from '@/modules/attendance/infrastructure/prisma-shift-assignment.repository';
import { PrismaShiftQueries } from '@/modules/attendance/infrastructure/prisma-shift.queries';
import { PrismaShiftRepository } from '@/modules/attendance/infrastructure/prisma-shift.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

// El TRUNCATE ... CASCADE vaciaría las asignaciones al vaciar los turnos; se listan ambas.
const database = useTestDatabase(['attendance.shift_assignments', 'attendance.shifts']);
const shifts = new PrismaShiftRepository({ database });
const assignments = new PrismaShiftAssignmentRepository({ database });
const queries = new PrismaShiftQueries({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-10-14T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const OTHER_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const USER = '00000000-0000-4000-8000-0000000000b1';
const PAGE = { page: 1, pageSize: 20 };

const WEEK: ShiftDay[] = [
  { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 },
  { type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 0 },
  { type: 'REST' },
];

function build(name: string, companyId = COMPANY, days: ShiftDay[] = WEEK): Shift {
  const created = Shift.create({
    id: ids.next() as ShiftId,
    companyId,
    name,
    cycleStartDate: '2026-11-02',
    toleranceMinutes: 15,
    days,
    now: NOW,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

async function saved(name: string, companyId = COMPANY): Promise<Shift> {
  const shift = build(name, companyId);
  const result = await shifts.add(shift);
  if (!result.ok) throw result.error;
  return shift;
}

function assignment(shift: Shift, effectiveFrom: string, assignedAt = NOW, employeeId = EMPLOYEE) {
  return {
    employeeId,
    companyId: COMPANY,
    shiftId: shift.id,
    effectiveFrom,
    assignedAt,
    assignedBy: USER,
  };
}

describe('PrismaShiftRepository', () => {
  it('guarda y recupera el turno con el ciclo JSONB intacto (días laborables, nocturnos y descansos)', async () => {
    const shift = await saved('Mixto');

    const found = await shifts.findById(shift.id);

    expect(found?.name).toBe('Mixto');
    expect(found?.nameKey).toBe('mixto');
    expect(found?.companyId).toBe(COMPANY);
    expect(found?.cycleStartDate).toBe('2026-11-02');
    expect(found?.toleranceMinutes).toBe(15);
    expect(found?.active).toBe(true);
    expect(found?.createdAt).toEqual(NOW);
    expect(found?.days).toEqual(WEEK);
  });

  it('la columna days es JSONB', async () => {
    await saved('Mixto');

    const rows = await database.client.$queryRawUnsafe<{ type: string }[]>(
      `SELECT jsonb_typeof(days) AS type FROM attendance.shifts`,
    );

    expect(rows).toEqual([{ type: 'array' }]);
  });

  it('findById de un id inexistente devuelve null', async () => {
    expect(await shifts.findById('00000000-0000-4000-8000-0000000000ff' as ShiftId)).toBeNull();
  });

  it('el mismo nombre en la misma empresa (sin distinguir mayúsculas) devuelve SHIFT_ALREADY_EXISTS', async () => {
    await saved('Oficina');

    const result = await shifts.add(build('OFICINA'));

    expect(!result.ok && result.error.code).toBe('SHIFT_ALREADY_EXISTS');
  });

  it('dos altas simultáneas con el mismo nombre: una gana y la otra recibe el error, sin excepción', async () => {
    const results = await Promise.all([shifts.add(build('Carrera')), shifts.add(build('Carrera'))]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    const codes = results.flatMap((result) => (result.ok ? [] : [result.error.code]));
    expect(codes).toEqual(['SHIFT_ALREADY_EXISTS']);
  });

  it('el mismo nombre en otra empresa se permite', async () => {
    await saved('Oficina');

    const result = await shifts.add(build('Oficina', OTHER_COMPANY));

    expect(result.ok).toBe(true);
  });
});

describe('PrismaShiftAssignmentRepository', () => {
  it('put inserta una asignación', async () => {
    const shift = await saved('Oficina');

    await assignments.put(assignment(shift, '2026-11-02'));

    const rows = await database.client.attendanceShiftAssignment.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      employeeId: EMPLOYEE,
      companyId: COMPANY,
      shiftId: shift.id,
      assignedBy: USER,
      assignedAt: NOW,
    });
    expect(rows[0]?.effectiveFrom.toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });

  it('put con la misma fecha reemplaza turno, hora y autor: una sola fila', async () => {
    const first = await saved('Primero');
    const second = await saved('Segundo');
    const later = new Date('2026-10-15T08:00:00Z');
    await assignments.put(assignment(first, '2026-11-02'));

    await assignments.put({
      ...assignment(second, '2026-11-02', later),
      assignedBy: '00000000-0000-4000-8000-0000000000b2',
    });

    const rows = await database.client.attendanceShiftAssignment.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      shiftId: second.id,
      assignedAt: later,
      assignedBy: '00000000-0000-4000-8000-0000000000b2',
    });
  });

  it('la misma fecha para otro colaborador es una fila distinta', async () => {
    const shift = await saved('Oficina');

    await assignments.put(assignment(shift, '2026-11-02'));
    await assignments.put(assignment(shift, '2026-11-02', NOW, OTHER_EMPLOYEE));

    expect(await database.client.attendanceShiftAssignment.count()).toBe(2);
  });
});

describe('PrismaShiftQueries', () => {
  it('listShifts: solo la empresa pedida, por nombre y luego id, con total', async () => {
    await saved('Zeta');
    await saved('Alfa');
    await saved('Ajeno', OTHER_COMPANY);

    const page = await queries.listShifts(COMPANY, PAGE);

    expect(page.items.map((item) => item.name)).toEqual(['Alfa', 'Zeta']);
    expect(page.total).toBe(2);
    expect(page.items[0]).toMatchObject({
      cycleStartDate: '2026-11-02',
      toleranceMinutes: 15,
      active: true,
      createdAt: NOW.toISOString(),
      days: WEEK,
    });
  });

  it('listShifts pagina sobre el total completo', async () => {
    await saved('A');
    await saved('B');
    await saved('C');

    const second = await queries.listShifts(COMPANY, { page: 2, pageSize: 2 });

    expect(second.items.map((item) => item.name)).toEqual(['C']);
    expect(second.total).toBe(3);
    expect(second.page).toBe(2);
    expect(second.pageSize).toBe(2);
  });

  it('listAssignments: del colaborador, más reciente primero, con el nombre del turno', async () => {
    const shift = await saved('Oficina');
    const other = await saved('Otro');
    await assignments.put(assignment(shift, '2026-01-05'));
    await assignments.put(assignment(other, '2026-12-07'));
    await assignments.put(assignment(shift, '2026-11-02'));
    await assignments.put(assignment(shift, '2026-11-02', NOW, OTHER_EMPLOYEE));

    const page = await queries.listAssignments(EMPLOYEE, PAGE);

    expect(page.total).toBe(3);
    expect(page.items).toEqual([
      {
        effectiveFrom: '2026-12-07',
        shiftId: other.id,
        shiftName: 'Otro',
        assignedAt: NOW.toISOString(),
        assignedBy: USER,
      },
      expect.objectContaining({ effectiveFrom: '2026-11-02', shiftName: 'Oficina' }),
      expect.objectContaining({ effectiveFrom: '2026-01-05', shiftName: 'Oficina' }),
    ]);
  });

  it('listAssignments pagina', async () => {
    const shift = await saved('Oficina');
    await assignments.put(assignment(shift, '2026-01-05'));
    await assignments.put(assignment(shift, '2026-02-02'));
    await assignments.put(assignment(shift, '2026-03-02'));

    const page = await queries.listAssignments(EMPLOYEE, { page: 2, pageSize: 2 });

    expect(page.items.map((item) => item.effectiveFrom)).toEqual(['2026-01-05']);
    expect(page.total).toBe(3);
  });
});
