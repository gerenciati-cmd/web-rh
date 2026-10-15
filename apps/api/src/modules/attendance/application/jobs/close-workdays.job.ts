import type { JobHandler, JobQueue, ScheduledJob } from '@/shared/application/jobs';
import type { Clock, Logger } from '@/shared/application/ports';

import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import { sweepRange, utcDate } from '../../domain/workday-recalculation';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

import { RECALCULATE_WORKDAYS, type RecalculateWorkdaysData } from './recalculate-workdays.job';

export const CLOSE_WORKDAYS = 'attendance.close-workdays';

/** Cada hora al minuto 5 (decisión 21); la zona solo fija cómo se lee el cron. */
export const CLOSE_WORKDAYS_SCHEDULE: ScheduledJob = {
  name: CLOSE_WORKDAYS,
  pattern: '5 * * * *',
  timeZone: 'America/Cancun',
};

interface Deps {
  shiftAssignmentRepository: ShiftAssignmentRepository;
  workdayEmployeeDirectory: WorkdayEmployeeDirectory;
  jobQueue: JobQueue;
  clock: Clock;
  logger: Logger;
}

/**
 * Cierre horario de jornadas (README de attendance-asistencia-diaria, decisión 21): encola un
 * recálculo de los últimos días por cada colaborador con turno asignado, para que las faltas
 * aparezcan cuando cierra la ventana del turno sin que nadie lo pida. Omite a quien ya no está en
 * el directorio y a quien se dio de baja antes del rango.
 */
export class CloseWorkdaysJob implements JobHandler {
  readonly name = CLOSE_WORKDAYS;

  constructor(private readonly deps: Deps) {}

  async handle(): Promise<void> {
    const { shiftAssignmentRepository, workdayEmployeeDirectory, jobQueue, clock, logger } =
      this.deps;
    const range = sweepRange(utcDate(clock.now()));

    let enqueued = 0;
    for (const { employeeId } of await shiftAssignmentRepository.listAssignedEmployees()) {
      const employee = await workdayEmployeeDirectory.find(employeeId);
      if (!employee) continue;
      if (employee.terminationDate !== null && employee.terminationDate < range.from) continue;
      const data: RecalculateWorkdaysData = { employeeId, ...range };
      await jobQueue.enqueue(RECALCULATE_WORKDAYS, data);
      enqueued += 1;
    }
    logger.info({ enqueued, from: range.from, to: range.to }, 'asistencia: cierre de jornadas');
  }
}
