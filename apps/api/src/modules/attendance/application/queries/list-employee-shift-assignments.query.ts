import type { Page, PageQuery, ShiftAssignmentDto } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import { EmployeeNotFoundError } from '../../domain/errors';
import type { ShiftEmployeeDirectory } from '../ports/shift-employee-directory';

import type { ShiftQueries } from './shift.queries';

type Input = PageQuery & { companyId: string; employeeId: string };

/** Historial de turnos de un colaborador; uno inexistente o de otra empresa es 404, no una página vacía. */
export class ListEmployeeShiftAssignments implements Command<Input, Page<ShiftAssignmentDto>> {
  constructor(
    private readonly deps: {
      shiftQueries: ShiftQueries;
      shiftEmployeeDirectory: ShiftEmployeeDirectory;
    },
  ) {}

  async execute({ companyId, employeeId, ...page }: Input) {
    const employee = await this.deps.shiftEmployeeDirectory.find(employeeId);
    if (employee?.companyId !== companyId) {
      return err<DomainError>(new EmployeeNotFoundError(employeeId));
    }
    return ok(await this.deps.shiftQueries.listAssignments(employeeId, page));
  }
}
