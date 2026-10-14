import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingJobQueue, RecordingLogger } from '@/shared/testing/fakes';

import type { ShiftId } from '../../domain/shift';
import {
  InMemoryShiftAssignmentRepository,
  InMemoryShiftStore,
} from '../../infrastructure/in-memory/in-memory-shift.store';
import type { WorkdayEmployee } from '../ports/workday-employee-directory';

import { CLOSE_WORKDAYS, CLOSE_WORKDAYS_SCHEDULE, CloseWorkdaysJob } from './close-workdays.job';
import { RECALCULATE_WORKDAYS } from './recalculate-workdays.job';

const COMPANY = '00000000-0000-4000-8000-0000000000c1';
const ACTIVE = '00000000-0000-4000-8000-0000000000e1';
const ENDED_BEFORE = '00000000-0000-4000-8000-0000000000e2';
const ENDED_ON_RANGE_START = '00000000-0000-4000-8000-0000000000e3';
const MISSING = '00000000-0000-4000-8000-0000000000e4';
const SHIFT = '00000000-0000-4000-8000-0000000000a1' as ShiftId;
const USER = '00000000-0000-4000-8000-0000000000b1';
const NOW = new Date('2026-10-14T12:00:00Z');

function employee(id: string, terminationDate: string | null): WorkdayEmployee {
  return {
    id,
    companyId: COMPANY,
    active: terminationDate === null,
    rfc: 'GOMA850101AB1',
    siteId: null,
    hireDate: '2026-01-10',
    terminationDate,
  };
}

const DIRECTORY = new Map<string, WorkdayEmployee>([
  [ACTIVE, employee(ACTIVE, null)],
  [ENDED_BEFORE, employee(ENDED_BEFORE, '2026-10-11')],
  [ENDED_ON_RANGE_START, employee(ENDED_ON_RANGE_START, '2026-10-12')],
]);

async function setUp(assigned: readonly string[]) {
  const store = new InMemoryShiftStore();
  const assignments = new InMemoryShiftAssignmentRepository(store);
  for (const employeeId of assigned) {
    await assignments.put({
      employeeId,
      companyId: COMPANY,
      shiftId: SHIFT,
      effectiveFrom: '2026-10-05',
      assignedAt: NOW,
      assignedBy: USER,
    });
  }
  // Una segunda asignación del mismo colaborador no debe duplicar su job.
  if (assigned[0]) {
    await assignments.put({
      employeeId: assigned[0],
      companyId: COMPANY,
      shiftId: SHIFT,
      effectiveFrom: '2026-10-12',
      assignedAt: NOW,
      assignedBy: USER,
    });
  }
  const jobQueue = new RecordingJobQueue();
  const logger = new RecordingLogger();
  const job = new CloseWorkdaysJob({
    shiftAssignmentRepository: assignments,
    workdayEmployeeDirectory: { find: (id) => Promise.resolve(DIRECTORY.get(id) ?? null) },
    jobQueue,
    clock: new FixedClock(NOW),
    logger,
  });
  return { job, jobQueue, logger };
}

describe('CloseWorkdaysJob', () => {
  const range = { from: '2026-10-12', to: '2026-10-14' };

  it('declara el cron horario al minuto 5 en America/Cancun con el nombre del job', () => {
    expect(CLOSE_WORKDAYS).toBe('attendance.close-workdays');
    expect(CLOSE_WORKDAYS_SCHEDULE).toEqual({
      name: 'attendance.close-workdays',
      pattern: '5 * * * *',
      timeZone: 'America/Cancun',
    });
  });

  it('encola un recálculo por colaborador con turno, de hoy − 2 a hoy', async () => {
    const { job, jobQueue, logger } = await setUp([ACTIVE]);

    await job.handle();

    expect(jobQueue.jobs).toEqual([
      {
        name: RECALCULATE_WORKDAYS,
        data: { employeeId: ACTIVE, ...range },
        options: undefined,
      },
    ]);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { enqueued: 1, ...range },
        msg: 'asistencia: cierre de jornadas',
      },
    ]);
  });

  it('un colaborador con varias asignaciones recibe un solo job', async () => {
    const { job, jobQueue } = await setUp([ACTIVE]);

    await job.handle();

    expect(jobQueue.jobs).toHaveLength(1);
  });

  it('omite al dado de baja antes del inicio del rango y conserva al de baja el primer día', async () => {
    const { job, jobQueue } = await setUp([ENDED_BEFORE, ENDED_ON_RANGE_START, ACTIVE]);

    await job.handle();

    expect(jobQueue.jobs.map((entry) => (entry.data as { employeeId: string }).employeeId)).toEqual(
      [ENDED_ON_RANGE_START, ACTIVE],
    );
  });

  it('omite al colaborador que ya no está en el directorio', async () => {
    const { job, jobQueue, logger } = await setUp([MISSING, ACTIVE]);

    await job.handle();

    expect(jobQueue.jobs.map((entry) => (entry.data as { employeeId: string }).employeeId)).toEqual(
      [ACTIVE],
    );
    expect(logger.entries[0]).toMatchObject({ obj: { enqueued: 1 } });
  });

  it('sin asignaciones no encola nada y lo registra', async () => {
    const { job, jobQueue, logger } = await setUp([]);

    await job.handle();

    expect(jobQueue.jobs).toEqual([]);
    expect(logger.entries[0]).toMatchObject({ level: 'info', obj: { enqueued: 0 } });
  });
});
