import type { EmployeeId } from '../domain/employee';
import type { EmployeeRepository } from '../domain/employee.repository';

import type { EmployeeQueries, EmployeeRfcOwner, SiteMember } from './queries/employee.queries';

/** Lo mínimo que otros módulos pueden saber de un colaborador. */
export interface EmployeeSummary {
  id: string;
  companyId: string;
  email: string;
  fullName: string;
  rfc: string | null;
  siteId: string | null;
  active: boolean;
}

/**
 * API PÚBLICA del módulo para otros módulos (se exporta desde `index.ts`).
 * Otros módulos nunca importan el agregado ni el repositorio: solo esta fachada.
 */
export interface EmployeesApi {
  findEmployee(employeeId: string): Promise<EmployeeSummary | null>;
  /** Colaboradores dueños de esos RFC (ya normalizados); ignora los que no coinciden. */
  findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]>;
  /** RFC de los colaboradores de esas empresas; ignora a quienes no tienen RFC. */
  rfcsInCompanies(companyIds: readonly string[]): Promise<string[]>;
  /** Colaboradores activos de una sede. Consumidor: la sincronización de asistencia. */
  listActiveOnSite(siteId: string): Promise<SiteMember[]>;
}

export class EmployeesFacade implements EmployeesApi {
  constructor(
    private readonly deps: {
      employeeRepository: EmployeeRepository;
      employeeQueries: EmployeeQueries;
    },
  ) {}

  async findEmployee(employeeId: string): Promise<EmployeeSummary | null> {
    const employee = await this.deps.employeeRepository.findById(employeeId as EmployeeId);
    if (!employee) return null;
    const { companyId, email, firstName, lastName, rfc, siteId, status } = employee.snapshot;
    return {
      id: employee.id,
      companyId,
      email: email.value,
      fullName: `${firstName} ${lastName}`,
      rfc: rfc?.value ?? null,
      siteId,
      active: status === 'ACTIVE',
    };
  }

  findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]> {
    return this.deps.employeeQueries.findByRfcs(rfcs);
  }

  rfcsInCompanies(companyIds: readonly string[]): Promise<string[]> {
    return this.deps.employeeQueries.rfcsInCompanies(companyIds);
  }

  listActiveOnSite(siteId: string): Promise<SiteMember[]> {
    return this.deps.employeeQueries.listActiveOnSite(siteId);
  }
}
