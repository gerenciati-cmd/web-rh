import type { OrganizationApi } from '@/modules/organization';

import type { ShiftCompanyDirectory } from '../application/ports/shift-company-directory';

/** Adaptador entre módulos: implementa el puerto de attendance con la API PÚBLICA de organization. */
export class OrganizationShiftCompanyDirectory implements ShiftCompanyDirectory {
  constructor(private readonly deps: { organizationApi: OrganizationApi }) {}

  async exists(companyId: string): Promise<boolean> {
    return (await this.deps.organizationApi.findCompany(companyId)) !== null;
  }
}
