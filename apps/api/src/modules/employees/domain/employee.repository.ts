import type { NationalId, PersonalRfc, Result } from '@rrhh/domain';

import type { Employee, EmployeeId } from './employee';
import type {
  EmployeeAlreadyExistsError,
  EmployeeAlreadyTerminatedError,
  EmployeeInactiveError,
  EmployeeRfcAlreadyRegisteredError,
} from './errors';

/**
 * Las escrituras son dirigidas por caso de uso: guardar la fila completa con un agregado cargado
 * antes permitía que un cambio de sede o RFC concurrente deshiciera una baja (hallazgo
 * `employees-guardado-completo-pisa-la-baja`). Las actualizaciones solo aplican mientras el
 * colaborador siga ACTIVE en la base: si otra petición lo dio de baja entretanto, retornan err.
 * Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa.
 */
export interface EmployeeRepository {
  findById(id: EmployeeId): Promise<Employee | null>;
  existsInCompany(companyId: string, nationalId: NationalId): Promise<boolean>;
  /** El RFC es único en todo el holding; `exceptId` excluye al propio colaborador al corregirlo. */
  existsByRfc(rfc: PersonalRfc, exceptId?: EmployeeId): Promise<boolean>;
  /** Alta de un colaborador nuevo. */
  add(
    employee: Employee,
  ): Promise<Result<void, EmployeeAlreadyExistsError | EmployeeRfcAlreadyRegisteredError>>;
  /** Escribe solo el RFC, y solo si el colaborador sigue activo. */
  saveRfc(
    employee: Employee,
  ): Promise<Result<void, EmployeeRfcAlreadyRegisteredError | EmployeeInactiveError>>;
  /** Escribe solo la sede, y solo si el colaborador sigue activo. */
  saveSite(employee: Employee): Promise<Result<void, EmployeeInactiveError>>;
  /** Escribe estado, fecha y motivo de la baja, y solo si el colaborador sigue activo. */
  saveTermination(employee: Employee): Promise<Result<void, EmployeeAlreadyTerminatedError>>;
}
