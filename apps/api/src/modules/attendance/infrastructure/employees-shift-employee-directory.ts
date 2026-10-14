import type { EmployeesApi } from '@/modules/employees';

import type {
  ShiftEmployee,
  ShiftEmployeeDirectory,
} from '../application/ports/shift-employee-directory';

/** Adaptador entre módulos: implementa el puerto de attendance con la API PÚBLICA de employees. */
export class EmployeesShiftEmployeeDirectory implements ShiftEmployeeDirectory {
  constructor(private readonly deps: { employeesApi: EmployeesApi }) {}

  async find(employeeId: string): Promise<ShiftEmployee | null> {
    const employee = await this.deps.employeesApi.findEmployee(employeeId);
    return employee
      ? { id: employee.id, companyId: employee.companyId, active: employee.active }
      : null;
  }
}
