import { err, ok, type DomainError } from '@rrhh/domain';

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

    await this.deps.shiftAssignmentRepository.put({
      employeeId: input.employeeId,
      companyId: input.companyId,
      shiftId: shift.id,
      effectiveFrom: input.effectiveFrom,
      assignedAt: this.deps.clock.now(),
      assignedBy: input.assignedBy,
    });
    return ok(undefined);
  }
}
