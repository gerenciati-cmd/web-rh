import type { NationalId, Result } from '@rrhh/domain';

import type { Employee, EmployeeId } from './employee';
import type { EmployeeAlreadyExistsError } from './errors';

export interface EmployeeRepository {
  findById(id: EmployeeId): Promise<Employee | null>;
  existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(employee: Employee): Promise<Result<void, EmployeeAlreadyExistsError>>;
}
