import type { NationalId } from '@rrhh/domain';

import type { Company, CompanyId } from './company';

/**
 * Puerto de ESCRITURA (lado command). Trabaja con agregados completos.
 * Nada de métodos "para pantallas": eso va en `CompanyQueries`.
 */
export interface CompanyRepository {
  findById(id: CompanyId): Promise<Company | null>;
  existsByTaxId(taxId: NationalId): Promise<boolean>;
  save(company: Company): Promise<void>;
}
