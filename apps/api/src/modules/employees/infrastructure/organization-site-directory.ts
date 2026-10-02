import type { OrganizationApi } from '@/modules/organization';

import type { SiteDirectory, WorkSite } from '../application/ports/site-directory';

/** Adaptador entre módulos: implementa el puerto de employees con la API PÚBLICA de organization. */
export class OrganizationSiteDirectory implements SiteDirectory {
  constructor(private readonly deps: { organizationApi: OrganizationApi }) {}

  async find(siteId: string): Promise<WorkSite | null> {
    const site = await this.deps.organizationApi.findSite(siteId);
    return site ? { id: site.id, country: site.country, active: site.active } : null;
  }
}
