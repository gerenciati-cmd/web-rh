import type { JobHandler, JobQueue } from '@/shared/application/jobs';
import type { Logger } from '@/shared/application/ports';

import { automaticRange } from '../../domain/workday-recalculation';
import type { RecalculateWorkdays } from '../commands/recalculate-workdays.command';
import type { PunchOwnerDirectory } from '../ports/punch-owner-directory';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

export const RECALCULATE_WORKDAYS = 'attendance.recalculate-workdays';

/**
 * Payload del job: exactamente uno de `employeeId` o `pin` (el PIN de una marcación, que se
 * resuelve al colaborador al ejecutar). Fechas `YYYY-MM-DD`, ya acotadas al encolar.
 */
export interface RecalculateWorkdaysData {
  employeeId?: string;
  pin?: string;
  from: string;
  to: string;
}

export type WorkdayRecalculationTarget = { employeeId: string } | { pin: string };

/**
 * Encola el recálculo de `[from, to]` acotado a los días automáticos hasta `today` (decisión 20);
 * si no queda ninguna fecha, no encola nada.
 */
export async function enqueueWorkdayRecalculation(
  jobQueue: JobQueue,
  target: WorkdayRecalculationTarget,
  from: string,
  to: string,
  today: string,
): Promise<void> {
  const range = automaticRange(from, to, today);
  if (!range) return;
  const data: RecalculateWorkdaysData = { ...target, ...range };
  await jobQueue.enqueue(RECALCULATE_WORKDAYS, data);
}

interface Deps {
  recalculateWorkdays: RecalculateWorkdays;
  workdayEmployeeDirectory: WorkdayEmployeeDirectory;
  punchOwnerDirectory: PunchOwnerDirectory;
  logger: Logger;
}

/**
 * Recalcula las jornadas de un colaborador por un disparador automático (decisión 19). Un
 * colaborador que no se puede recalcular (inexistente, sin RFC, sin sede…) se registra y el job
 * termina: reintentar no lo arregla. Lo inesperado se propaga para que BullMQ reintente.
 */
export class RecalculateWorkdaysJob implements JobHandler<RecalculateWorkdaysData> {
  readonly name = RECALCULATE_WORKDAYS;

  constructor(private readonly deps: Deps) {}

  async handle(data: RecalculateWorkdaysData): Promise<void> {
    const { logger } = this.deps;
    const target = await this.resolve(data);
    if (!target) return;

    const result = await this.deps.recalculateWorkdays.execute({
      companyId: target.companyId,
      employeeId: target.employeeId,
      from: data.from,
      to: data.to,
    });
    if (!result.ok) {
      logger.warn(
        { employeeId: target.employeeId, code: result.error.code },
        'asistencia: recálculo omitido',
      );
      return;
    }
    logger.info(
      {
        employeeId: target.employeeId,
        from: data.from,
        to: data.to,
        recalculatedDates: result.value.recalculatedDates,
        storedWorkdays: result.value.storedWorkdays,
        pendingDates: result.value.pendingDates.length,
      },
      'asistencia: jornadas recalculadas',
    );
  }

  private async resolve(
    data: RecalculateWorkdaysData,
  ): Promise<{ employeeId: string; companyId: string } | null> {
    const { logger } = this.deps;
    if (data.pin !== undefined) {
      const owner = (await this.deps.punchOwnerDirectory.ownersOf([data.pin])).get(data.pin);
      // Un PIN sin colaborador es normal (usuarios de prueba en el checador): no es un aviso.
      if (!owner) logger.debug({ pin: data.pin }, 'asistencia: PIN sin colaborador');
      return owner ? { employeeId: owner.employeeId, companyId: owner.companyId } : null;
    }
    if (data.employeeId !== undefined) {
      const employee = await this.deps.workdayEmployeeDirectory.find(data.employeeId);
      if (!employee) {
        logger.warn({ employeeId: data.employeeId }, 'asistencia: colaborador no encontrado');
      }
      return employee ? { employeeId: employee.id, companyId: employee.companyId } : null;
    }
    logger.warn({ data }, 'asistencia: job de recálculo sin colaborador');
    return null;
  }
}
