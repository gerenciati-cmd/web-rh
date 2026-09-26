import type { EmployeeListItem, Page, PageQuery } from '@rrhh/contracts';

export interface EmployeeDirectoryFilters extends PageQuery {
  companyId: string;
  status?: EmployeeListItem['status'] | undefined;
  search?: string | undefined;
}

/** Puerto de lectura: listados y vistas de colaboradores. */
export interface EmployeeQueries {
  listDirectory(filters: EmployeeDirectoryFilters): Promise<Page<EmployeeListItem>>;
}
