import type { EmployeesApi } from '@/modules/employees';

import type {
  WorkdayEmployee,
  WorkdayEmployeeDirectory,
} from '../application/ports/workday-employee-directory';

/** Adaptador entre módulos: implementa el puerto de attendance con la API PÚBLICA de employees. */
export class EmployeesWorkdayEmployeeDirectory implements WorkdayEmployeeDirectory {
  constructor(private readonly deps: { employeesApi: EmployeesApi }) {}

  async find(employeeId: string): Promise<WorkdayEmployee | null> {
    const employee = await this.deps.employeesApi.findEmployee(employeeId);
    return employee
      ? {
          id: employee.id,
          companyId: employee.companyId,
          active: employee.active,
          rfc: employee.rfc,
          siteId: employee.siteId,
          hireDate: employee.hireDate,
          terminationDate: employee.terminationDate,
        }
      : null;
  }
}
