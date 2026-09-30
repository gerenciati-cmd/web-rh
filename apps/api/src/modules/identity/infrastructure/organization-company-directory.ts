import type { OrganizationApi } from '@/modules/organization';

import type { AssignableCompany, CompanyDirectory } from '../application/ports/company-directory';

/**
 * Adaptador entre módulos: implementa el puerto de identity usando la API PÚBLICA de
 * organization (ADR 0010 regla 2).
 */
export class OrganizationCompanyDirectory implements CompanyDirectory {
  constructor(private readonly deps: { organizationApi: OrganizationApi }) {}

  async find(companyId: string): Promise<AssignableCompany | null> {
    const company = await this.deps.organizationApi.findCompany(companyId);
    return company ? { id: company.id, active: company.active } : null;
  }
}
