import type { EmployeeId } from '../domain/employee';
import type { EmployeeRepository } from '../domain/employee.repository';

/** Lo mínimo que otros módulos pueden saber de un colaborador. */
export interface EmployeeSummary {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  active: boolean;
}

/**
 * API PÚBLICA del módulo para otros módulos (se exporta desde `index.ts`).
 * Otros módulos nunca importan el agregado ni el repositorio: solo esta fachada.
 */
export interface EmployeesApi {
  findEmployee(employeeId: string): Promise<EmployeeSummary | null>;
}

export class EmployeesFacade implements EmployeesApi {
  constructor(private readonly deps: { employeeRepository: EmployeeRepository }) {}

  async findEmployee(employeeId: string): Promise<EmployeeSummary | null> {
    const employee = await this.deps.employeeRepository.findById(employeeId as EmployeeId);
    if (!employee) return null;
    const { companyId, email, firstName, lastName, status } = employee.snapshot;
    return {
      id: employee.id,
      companyId,
      email: email.value,
      fullName: `${firstName} ${lastName}`,
      active: status === 'ACTIVE',
    };
  }
}
