import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';

/**
 * Puerto de LECTURA (lado query de CQRS ligero). Devuelve DTOs listos para la UI,
 * sin pasar por el agregado. El adaptador puede optimizar libremente (select, joins, vistas).
 */
export interface CompanyQueries {
  list(page: PageQuery): Promise<Page<CompanyDto>>;
  findById(id: string): Promise<CompanyDto | null>;
}
