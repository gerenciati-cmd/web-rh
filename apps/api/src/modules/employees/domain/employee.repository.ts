import type { NationalId, PersonalRfc, Result } from '@rrhh/domain';

import type { Employee, EmployeeId } from './employee';
import type { EmployeeAlreadyExistsError, EmployeeRfcAlreadyRegisteredError } from './errors';

export interface EmployeeRepository {
  findById(id: EmployeeId): Promise<Employee | null>;
  existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean>;
  /** El RFC es único en todo el holding; `exceptId` excluye al propio colaborador al corregirlo. */
  existsByRfc(rfc: PersonalRfc, exceptId?: EmployeeId): Promise<boolean>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>>;
}
