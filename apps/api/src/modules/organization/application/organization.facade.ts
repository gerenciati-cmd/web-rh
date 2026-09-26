import type { CountryCode } from '@rrhh/domain';

import type { CompanyId } from '../domain/company';
import type { CompanyRepository } from '../domain/company.repository';

/** Lo mínimo que otros módulos pueden saber de una empresa. */
export interface CompanySummary {
  id: string;
  country: CountryCode;
  active: boolean;
}

/**
 * API PÚBLICA del módulo para otros módulos (se exporta desde `index.ts`).
 * Otros módulos nunca importan el agregado ni el repositorio: solo esta fachada.
 */
export interface OrganizationApi {
  findCompany(companyId: string): Promise<CompanySummary | null>;
}

export class OrganizationFacade implements OrganizationApi {
  constructor(private readonly deps: { companyRepository: CompanyRepository }) {}

  async findCompany(companyId: string): Promise<CompanySummary | null> {
    const company = await this.deps.companyRepository.findById(companyId as CompanyId);
    if (!company) return null;
    return { id: company.id, country: company.taxId.country, active: company.active };
  }
}
