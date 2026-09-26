import type { NationalId } from '@rrhh/domain';

import type { Employee, EmployeeId } from './employee';

export interface EmployeeRepository {
  findById(id: EmployeeId): Promise<Employee | null>;
  existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean>;
  save(employee: Employee): Promise<void>;
}
