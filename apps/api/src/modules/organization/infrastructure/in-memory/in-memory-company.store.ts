import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';
import type { NationalId } from '@rrhh/domain';

import type { CompanyQueries } from '../../application/queries/company.queries';
import type { Company, CompanyId } from '../../domain/company';
import type { CompanyRepository } from '../../domain/company.repository';

/**
 * Adaptadores en memoria para tests. Cumplen los MISMOS contratos que la versión Prisma,
 * así que cualquier caso de uso funciona igual con uno u otro (Liskov).
 * Repositorio y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemoryCompanyStore {
  readonly companies = new Map<string, Company>();
}

export class InMemoryCompanyRepository implements CompanyRepository {
  constructor(private readonly store: InMemoryCompanyStore) {}

  findById(id: CompanyId): Promise<Company | null> {
    return Promise.resolve(this.store.companies.get(id) ?? null);
  }

  existsByTaxId(taxId: NationalId): Promise<boolean> {
    const companies = [...this.store.companies.values()];
    return Promise.resolve(companies.some((company) => company.taxId.equals(taxId)));
  }

  save(company: Company): Promise<void> {
    this.store.companies.set(company.id, company);
    return Promise.resolve();
  }
}

export class InMemoryCompanyQueries implements CompanyQueries {
  constructor(private readonly store: InMemoryCompanyStore) {}

  list({ page, pageSize }: PageQuery): Promise<Page<CompanyDto>> {
    const all = [...this.store.companies.values()]
      .sort((a, b) => a.legalName.localeCompare(b.legalName))
      .map(toDto);
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  findById(id: string): Promise<CompanyDto | null> {
    const company = this.store.companies.get(id);
    return Promise.resolve(company ? toDto(company) : null);
  }
}

function toDto(company: Company): CompanyDto {
  return {
    id: company.id,
    legalName: company.legalName,
    taxId: company.taxId.format(),
    country: company.taxId.country,
    active: company.active,
    createdAt: company.createdAt.toISOString(),
  };
}
