import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';

/**
 * Puerto de LECTURA (lado query de CQRS ligero). Devuelve DTOs listos para la UI,
 * sin pasar por el agregado. El adaptador puede optimizar libremente (select, joins, vistas).
 */
export interface CompanyQueries {
  /** `visible`: `'ALL'` o los ids de empresa que el actor puede ver. */
  list(page: PageQuery, visible: 'ALL' | readonly string[]): Promise<Page<CompanyDto>>;
  findById(id: string): Promise<CompanyDto | null>;
}
