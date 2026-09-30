import type { EmployeesApi } from '@/modules/employees';

import type { EmployeeDirectory, InvitableEmployee } from '../application/ports/employee-directory';

/**
 * Adaptador entre módulos: implementa el puerto de identity usando la API PÚBLICA de
 * employees (ADR 0010 regla 2).
 */
export class EmployeesEmployeeDirectory implements EmployeeDirectory {
  constructor(private readonly deps: { employeesApi: EmployeesApi }) {}

  async find(employeeId: string): Promise<InvitableEmployee | null> {
    const employee = await this.deps.employeesApi.findEmployee(employeeId);
    if (!employee) return null;
    return {
      id: employee.id,
      companyId: employee.companyId,
      email: employee.email,
      fullName: employee.fullName,
      active: employee.active,
    };
  }
}
