import type { OrganizationApi } from '@/modules/organization';

import type { Employer, EmployerDirectory } from '../application/ports/employer-directory';

/**
 * Adaptador entre módulos: implementa el puerto de employees usando la API PÚBLICA
 * de organization. Si mañana organization se vuelve un microservicio, solo cambia
 * este archivo (por un cliente HTTP) y el resto de employees no se entera.
 */
export class OrganizationEmployerDirectory implements EmployerDirectory {
  constructor(private readonly deps: { organizationApi: OrganizationApi }) {}

  async find(companyId: string): Promise<Employer | null> {
    const company = await this.deps.organizationApi.findCompany(companyId);
    return company ? { id: company.id, country: company.country, active: company.active } : null;
  }
}
