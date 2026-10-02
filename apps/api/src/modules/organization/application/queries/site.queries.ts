import type { Page, PageQuery, SiteDto } from '@rrhh/contracts';

/**
 * Puerto de LECTURA (lado query de CQRS ligero). Las sedes son del holding:
 * no hay filtro por empresa.
 */
export interface SiteQueries {
  list(page: PageQuery): Promise<Page<SiteDto>>;
  findById(id: string): Promise<SiteDto | null>;
}
