import { err, ok, type NationalId, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import type { Company, CompanyId } from '../domain/company';
import type { CompanyRepository } from '../domain/company.repository';
import { CompanyAlreadyExistsError } from '../domain/errors';

import { CompanyMapper } from './company.mapper';

export class PrismaCompanyRepository implements CompanyRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: CompanyId): Promise<Company | null> {
    const row = await this.deps.database.client.company.findUnique({ where: { id } });
    return row ? CompanyMapper.toDomain(row) : null;
  }

  async existsByTaxId(taxId: NationalId): Promise<boolean> {
    const count = await this.deps.database.client.company.count({
      where: { country: taxId.country, taxId: taxId.value },
    });
    return count > 0;
  }

  async save(company: Company): Promise<Result<void, CompanyAlreadyExistsError>> {
    const data = CompanyMapper.toPersistence(company);
    try {
      await this.deps.database.client.company.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      return ok(undefined);
    } catch (error) {
      // Carrera entre dos requests que pasaron el `existsByTaxId`: el índice único decide.
      if (isUniqueViolation(error))
        return err(new CompanyAlreadyExistsError(company.taxId.format()));
      throw error;
    }
  }
}
