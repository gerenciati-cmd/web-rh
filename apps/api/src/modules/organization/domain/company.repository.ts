import type { NationalId, Result } from '@rrhh/domain';

import type { Company, CompanyId } from './company';
import type { CompanyAlreadyExistsError } from './errors';

/**
 * Puerto de ESCRITURA (lado command). Trabaja con agregados completos.
 * Nada de métodos "para pantallas": eso va en `CompanyQueries`.
 */
export interface CompanyRepository {
  findById(id: CompanyId): Promise<Company | null>;
  existsByTaxId(taxId: NationalId): Promise<boolean>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(company: Company): Promise<Result<void, CompanyAlreadyExistsError>>;
}
