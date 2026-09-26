import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { CompanyQueries } from './company.queries';

export class ListCompanies implements UseCase<PageQuery, Page<CompanyDto>> {
  constructor(private readonly deps: { companyQueries: CompanyQueries }) {}

  execute(page: PageQuery): Promise<Page<CompanyDto>> {
    return this.deps.companyQueries.list(page);
  }
}
