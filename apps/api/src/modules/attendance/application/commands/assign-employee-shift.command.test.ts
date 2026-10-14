import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingJobQueue } from '@/shared/testing/fakes';

import { Shift, type ShiftId } from '../../domain/shift';
import {
  InMemoryShiftAssignmentRepository,
  InMemoryShiftQueries,
  InMemoryShiftRepository,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';

import { AssignEmployeeShift } from './assign-employee-shift.command';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const OTHER_COMPANY = '00000000-0000-4000-8000-0000000000c2';
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const FOREIGN_EMPLOYEE = '00000000-0000-4000-8000-0000000000e2';
const TERMINATED_EMPLOYEE = '00000000-0000-4000-8000-0000000000e3';
const SHIFT_A = '00000000-0000-4000-8000-0000000000a1';
const SHIFT_B = '00000000-0000-4000-8000-0000000000a2';
const FOREIGN_SHIFT = '00000000-0000-4000-8000-0000000000a3';
const USER = '00000000-0000-4000-8000-0000000000b1';
const PAGE = { page: 1, pageSize: 20 };

const EMPLOYEES = new Map([
  [EMPLOYEE, { id: EMPLOYEE, companyId: COMPANY, active: true }],
  [FOREIGN_EMPLOYEE, { id: FOREIGN_EMPLOYEE, companyId: OTHER_COMPANY, active: true }],
  [TERMINATED_EMPLOYEE, { id: TERMINATED_EMPLOYEE, companyId: COMPANY, active: false }],
]);

async function setUp(now = new Date('2026-10-14T12:00:00Z')) {
  const store = new InMemoryShiftStore();
  const shiftRepository = new InMemoryShiftRepository(store);
  for (const [id, companyId] of [
    [SHIFT_A, COMPANY],
    [SHIFT_B, COMPANY],
    [FOREIGN_SHIFT, OTHER_COMPANY],
  ] as const) {
    const shift = Shift.create({
      id: id as ShiftId,
      companyId,
      name: `Turno ${id.slice(-2)}`,
      cycleStartDate: '2026-11-02',
      toleranceMinutes: 0,
      days: [{ type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 }],
      now,
    });
    if (!shift.ok) throw shift.error;
    await shiftRepository.add(shift.value);
  }
  const clock = new FixedClock(now);
  const command = new AssignEmployeeShift({
    shiftRepository,
    shiftAssignmentRepository: new InMemoryShiftAssignmentRepository(store),
    shiftEmployeeDirectory: { find: (id: string) => Promise.resolve(EMPLOYEES.get(id) ?? null) },
    clock,
    jobQueue: new RecordingJobQueue(),
  });
  return { command, queries: new InMemoryShiftQueries(store), clock };
}

const input = {
  companyId: COMPANY,
  employeeId: EMPLOYEE,
  effectiveFrom: '2026-11-02',
  shiftId: SHIFT_A,
  assignedBy: USER,
};

describe('AssignEmployeeShift', () => {
  it('asigna el turno: queda en el historial con la hora del reloj y quién lo asignó', async () => {
    const { command, queries } = await setUp();

    const result = await command.execute(input);

    expect(result.ok).toBe(true);
    const history = await queries.listAssignments(EMPLOYEE, PAGE);
    expect(history.items).toEqual([
      {
        effectiveFrom: '2026-11-02',
        shiftId: SHIFT_A,
        shiftName: 'Turno a1',
        assignedAt: '2026-10-14T12:00:00.000Z',
        assignedBy: USER,
      },
    ]);
  });

  it('repetir la fecha reemplaza la asignación (un solo registro, turno y hora nuevos)', async () => {
    const { command, queries, clock } = await setUp();
    await command.execute(input);
    clock.set(new Date('2026-10-15T08:00:00Z'));

    const result = await command.execute({ ...input, shiftId: SHIFT_B });

    expect(result.ok).toBe(true);
    const history = await queries.listAssignments(EMPLOYEE, PAGE);
    expect(history.total).toBe(1);
    expect(history.items[0]?.shiftId).toBe(SHIFT_B);
    expect(history.items[0]?.assignedAt).toBe('2026-10-15T08:00:00.000Z');
  });

  it('una fecha distinta agrega otra fila, de la más reciente a la más antigua', async () => {
    const { command, queries } = await setUp();
    await command.execute(input);
    await command.execute({ ...input, effectiveFrom: '2026-12-01', shiftId: SHIFT_B });
    await command.execute({ ...input, effectiveFrom: '2026-01-05' });

    const history = await queries.listAssignments(EMPLOYEE, PAGE);

    expect(history.items.map((item) => item.effectiveFrom)).toEqual([
      '2026-12-01',
      '2026-11-02',
      '2026-01-05',
    ]);
  });

  it('colaborador inexistente: EMPLOYEE_NOT_FOUND', async () => {
    const { command } = await setUp();

    const result = await command.execute({
      ...input,
      employeeId: '00000000-0000-4000-8000-0000000000ff',
    });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('colaborador de otra empresa: EMPLOYEE_NOT_FOUND', async () => {
    const { command } = await setUp();

    const result = await command.execute({ ...input, employeeId: FOREIGN_EMPLOYEE });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('colaborador desvinculado: EMPLOYEE_INACTIVE', async () => {
    const { command } = await setUp();

    const result = await command.execute({ ...input, employeeId: TERMINATED_EMPLOYEE });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_INACTIVE');
  });

  it('turno inexistente: SHIFT_NOT_FOUND', async () => {
    const { command } = await setUp();

    const result = await command.execute({
      ...input,
      shiftId: '00000000-0000-4000-8000-0000000000ff',
    });

    expect(!result.ok && result.error.code).toBe('SHIFT_NOT_FOUND');
  });

  it('turno de otra empresa: SHIFT_NOT_FOUND y no asigna', async () => {
    const { command, queries } = await setUp();

    const result = await command.execute({ ...input, shiftId: FOREIGN_SHIFT });

    expect(!result.ok && result.error.code).toBe('SHIFT_NOT_FOUND');
    expect((await queries.listAssignments(EMPLOYEE, PAGE)).total).toBe(0);
  });
});
