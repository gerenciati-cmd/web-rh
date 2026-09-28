import type { CompanyDto } from '@rrhh/contracts';
import { TaxId, type CountryCode } from '@rrhh/domain';

import type { Company as CompanyRow } from '@/infrastructure/database/generated/client';

import { Company, type CompanyId } from '../domain/company';

/**
 * Traductor entre el mundo de persistencia (filas Prisma) y el dominio/DTOs.
 * Es el ÚNICO lugar donde conviven ambos tipos: ninguno se filtra al otro lado.
 */
export const CompanyMapper = {
  toDomain(row: CompanyRow): Company {
    const taxId = TaxId.create(row.country as CountryCode, row.taxId);
    // Si la BD tiene un dato inválido es corrupción, no un caso de negocio: fallar fuerte.
    if (!taxId.ok) throw taxId.error;

    return Company.restore(row.id as CompanyId, {
      legalName: row.legalName,
      taxId: taxId.value,
      active: row.active,
      createdAt: row.createdAt,
    });
  },

  toPersistence(company: Company) {
    return {
      id: company.id,
      legalName: company.legalName,
      taxId: company.taxId.value,
      country: company.taxId.country,
      active: company.active,
      createdAt: company.createdAt,
    };
  },

  toDto(
    row: Pick<CompanyRow, 'id' | 'legalName' | 'taxId' | 'country' | 'active' | 'createdAt'>,
  ): CompanyDto {
    const taxId = TaxId.create(row.country as CountryCode, row.taxId);
    return {
      id: row.id,
      legalName: row.legalName,
      taxId: taxId.ok ? taxId.value.format() : row.taxId,
      country: row.country as CountryCode,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  },
};
