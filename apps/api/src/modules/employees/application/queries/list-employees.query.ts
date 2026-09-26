import type { EmployeeListItem, Page } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { EmployeeDirectoryFilters, EmployeeQueries } from './employee.queries';

export class ListEmployees implements UseCase<EmployeeDirectoryFilters, Page<EmployeeListItem>> {
  constructor(private readonly deps: { employeeQueries: EmployeeQueries }) {}

  execute(filters: EmployeeDirectoryFilters): Promise<Page<EmployeeListItem>> {
    return this.deps.employeeQueries.listDirectory(filters);
  }
}
