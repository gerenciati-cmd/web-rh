import type { CompanyDto } from '@rrhh/contracts';
import { err, ok, type Result } from '@rrhh/domain';

import type { UseCase } from '@/shared/application/use-case';

import { CompanyNotFoundError } from '../../domain/errors';

import type { CompanyQueries } from './company.queries';

export class GetCompany implements UseCase<
  { companyId: string },
  Result<CompanyDto, CompanyNotFoundError>
> {
  constructor(private readonly deps: { companyQueries: CompanyQueries }) {}

  async execute({ companyId }: { companyId: string }) {
    const company = await this.deps.companyQueries.findById(companyId);
    return company ? ok(company) : err(new CompanyNotFoundError(companyId));
  }
}
