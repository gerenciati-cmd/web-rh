import type { OrganizationApi } from '@/modules/organization';

import type { DeviceSite, SiteDirectory } from '../application/ports/site-directory';

/** Adaptador entre módulos: implementa el puerto de attendance con la API PÚBLICA de organization. */
export class OrganizationSiteDirectory implements SiteDirectory {
  constructor(private readonly deps: { organizationApi: OrganizationApi }) {}

  async find(siteId: string): Promise<DeviceSite | null> {
    const site = await this.deps.organizationApi.findSite(siteId);
    return site ? { id: site.id, timeZone: site.timeZone, active: site.active } : null;
  }
}
