import type { Page, PageQuery, SiteDto } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { SiteQueries } from './site.queries';

/** Lista paginada de sedes del holding (sin filtro por empresa). */
export class ListSites implements UseCase<PageQuery, Page<SiteDto>> {
  constructor(private readonly deps: { siteQueries: SiteQueries }) {}

  execute(page: PageQuery): Promise<Page<SiteDto>> {
    return this.deps.siteQueries.list(page);
  }
}
