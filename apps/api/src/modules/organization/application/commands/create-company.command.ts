import { err, NationalId, ok, type CountryCode, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { Company, type CompanyId } from '../../domain/company';
import type { CompanyRepository } from '../../domain/company.repository';
import { CompanyAlreadyExistsError } from '../../domain/errors';

export interface CreateCompanyInput {
  legalName: string;
  taxId: string;
  country: CountryCode;
}

/**
 * Cada caso de uso declara SOLO las dependencias que usa (ISP) y las recibe
 * como abstracciones (DIP). No sabe si detrás hay Prisma, memoria o un mock.
 */
interface Deps {
  companyRepository: CompanyRepository;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

export class CreateCompany implements Command<CreateCompanyInput, { id: CompanyId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateCompanyInput) {
    const taxId = NationalId.create(input.country, input.taxId);
    if (!taxId.ok) return taxId;

    if (await this.deps.companyRepository.existsByTaxId(taxId.value)) {
      return err<DomainError>(new CompanyAlreadyExistsError(taxId.value.format()));
    }

    const company = Company.create({
      id: this.deps.idGenerator.next() as CompanyId,
      legalName: input.legalName,
      taxId: taxId.value,
      now: this.deps.clock.now(),
    });
    if (!company.ok) return company;

    await this.deps.companyRepository.save(company.value);
    await this.deps.eventBus.publish(company.value.pullEvents());

    return ok({ id: company.value.id });
  }
}
