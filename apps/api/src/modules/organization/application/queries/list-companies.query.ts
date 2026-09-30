import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';

import { companiesWith, type Actor } from '@/shared/application/actor';
import type { UseCase } from '@/shared/application/use-case';

import type { CompanyQueries } from './company.queries';

export type ListCompaniesInput = PageQuery & { actor: Actor };

/** Solo devuelve las empresas sobre las que el actor tiene `organization.companies:read`. */
export class ListCompanies implements UseCase<ListCompaniesInput, Page<CompanyDto>> {
  constructor(private readonly deps: { companyQueries: CompanyQueries }) {}

  execute({ actor, ...page }: ListCompaniesInput): Promise<Page<CompanyDto>> {
    return this.deps.companyQueries.list(page, companiesWith(actor, 'organization.companies:read'));
  }
}
