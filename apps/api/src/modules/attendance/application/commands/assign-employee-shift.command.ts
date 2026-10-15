import { err, ok, type DomainError } from '@rrhh/domain';

import type { JobQueue } from '@/shared/application/jobs';
import type { Clock } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  EmployeeInactiveError,
  EmployeeNotFoundError,
  ShiftNotFoundError,
} from '../../domain/errors';
import type { ShiftId } from '../../domain/shift';
import type { ShiftAssignmentRepository } from '../../domain/shift-assignment.repository';
import type { ShiftRepository } from '../../domain/shift.repository';
import { utcDate } from '../../domain/workday-recalculation';
import { enqueueWorkdayRecalculation } from '../jobs/recalculate-workdays.job';
import type { ShiftEmployeeDirectory } from '../ports/shift-employee-directory';

export interface AssignEmployeeShiftInput {
  companyId: string;
  employeeId: string;
  effectiveFrom: string;
  shiftId: string;
  assignedBy: string;
}

interface Deps {
  shiftRepository: ShiftRepository;
  shiftAssignmentRepository: ShiftAssignmentRepository;
  shiftEmployeeDirectory: ShiftEmployeeDirectory;
  clock: Clock;
  jobQueue: JobQueue;
}

/**
 * Asigna un turno a un colaborador desde una fecha. Repetir la fecha reemplaza la asignación, así
 * RH corrige un error sin necesidad de borrar. Un colaborador o turno de otra empresa responde
 * como inexistente.
 */
export class AssignEmployeeShift implements Command<AssignEmployeeShiftInput, undefined> {
  constructor(private readonly deps: Deps) {}

  async execute(input: AssignEmployeeShiftInput) {
    const employee = await this.deps.shiftEmployeeDirectory.find(input.employeeId);
    if (employee?.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError(input.employeeId));
    }
    if (!employee.active) return err<DomainError>(new EmployeeInactiveError(input.employeeId));

    const shift = await this.deps.shiftRepository.findById(input.shiftId as ShiftId);
    if (shift?.companyId !== input.companyId) {
      return err<DomainError>(new ShiftNotFoundError(input.shiftId));
    }

    const now = this.deps.clock.now();
    await this.deps.shiftAssignmentRepository.put({
      employeeId: input.employeeId,
      companyId: input.companyId,
      shiftId: shift.id,
      effectiveFrom: input.effectiveFrom,
      assignedAt: now,
      assignedBy: input.assignedBy,
    });
    // Las jornadas desde esa fecha se calcularon con el turno anterior (decisión 19). Una fecha
    // futura no encola nada: el cierre horario la toma cuando llegue.
    const today = utcDate(now);
    await enqueueWorkdayRecalculation(
      this.deps.jobQueue,
      { employeeId: input.employeeId },
      input.effectiveFrom,
      today,
      today,
    );
    return ok(undefined);
  }
}
