import type { EmployeeListItem, Page, PageQuery } from '@rrhh/contracts';

export interface EmployeeDirectoryFilters extends PageQuery {
  companyId: string;
  status?: EmployeeListItem['status'] | undefined;
  search?: string | undefined;
}

/**
 * Colaborador identificado por su RFC. Consumidor: `attendance-marcaciones/002`; ambas consultas
 * ignoran a los colaboradores sin RFC.
 */
export interface EmployeeRfcOwner {
  id: string;
  companyId: string;
  fullName: string;
  rfc: string;
  active: boolean;
}

/** Puerto de lectura: listados y vistas de colaboradores. */
export interface EmployeeQueries {
  listDirectory(filters: EmployeeDirectoryFilters): Promise<Page<EmployeeListItem>>;
  findByRfcs(rfcs: readonly string[]): Promise<EmployeeRfcOwner[]>;
  rfcsInCompanies(companyIds: readonly string[]): Promise<string[]>;
}
