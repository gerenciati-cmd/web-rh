import type { WorkdayDto } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import { EmployeeNotFoundError } from '../../domain/errors';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

import type { WorkdayQueries } from './workday.queries';

interface Input {
  companyId: string;
  employeeId: string;
  from: string;
  to: string;
}

/** Jornadas guardadas de un colaborador; uno inexistente o de otra empresa es 404, no una lista vacía. */
export class ListEmployeeWorkdays implements Command<Input, { items: WorkdayDto[] }> {
  constructor(
    private readonly deps: {
      workdayQueries: WorkdayQueries;
      workdayEmployeeDirectory: WorkdayEmployeeDirectory;
    },
  ) {}

  async execute({ companyId, employeeId, from, to }: Input) {
    const employee = await this.deps.workdayEmployeeDirectory.find(employeeId);
    if (employee?.companyId !== companyId) {
      return err<DomainError>(new EmployeeNotFoundError(employeeId));
    }
    return ok({ items: await this.deps.workdayQueries.listByEmployee(employeeId, from, to) });
  }
}
