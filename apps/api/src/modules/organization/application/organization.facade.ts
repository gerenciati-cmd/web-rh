import type { CountryCode } from '@rrhh/domain';

import type { CompanyId } from '../domain/company';
import type { CompanyRepository } from '../domain/company.repository';
import type { SiteId } from '../domain/site';
import type { SiteRepository } from '../domain/site.repository';

/** Lo mínimo que otros módulos pueden saber de una empresa. */
export interface CompanySummary {
  id: string;
  country: CountryCode;
  active: boolean;
}

/** Lo mínimo que otros módulos pueden saber de una sede. */
export interface SiteSummary {
  id: string;
  name: string;
  country: CountryCode;
  timeZone: string;
  active: boolean;
}

/**
 * API PÚBLICA del módulo para otros módulos (se exporta desde `index.ts`).
 * Otros módulos nunca importan el agregado ni el repositorio: solo esta fachada.
 * `findSite` lo consumirán las series planeadas de employees y attendance.
 */
export interface OrganizationApi {
  findCompany(companyId: string): Promise<CompanySummary | null>;
  findSite(siteId: string): Promise<SiteSummary | null>;
}

export class OrganizationFacade implements OrganizationApi {
  constructor(
    private readonly deps: { companyRepository: CompanyRepository; siteRepository: SiteRepository },
  ) {}

  async findCompany(companyId: string): Promise<CompanySummary | null> {
    const company = await this.deps.companyRepository.findById(companyId as CompanyId);
    if (!company) return null;
    return { id: company.id, country: company.taxId.country, active: company.active };
  }

  async findSite(siteId: string): Promise<SiteSummary | null> {
    const site = await this.deps.siteRepository.findById(siteId as SiteId);
    if (!site) return null;
    return {
      id: site.id,
      name: site.name,
      country: site.country,
      timeZone: site.timeZone,
      active: site.active,
    };
  }
}
