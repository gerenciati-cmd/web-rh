import type { LatenessRuleDto } from '@rrhh/contracts';

/** Lecturas de reglas de retardos para pantallas; no tocan el dominio. */
export interface LatenessRuleQueries {
  /** Reglas de la empresa, de la `effectiveFrom` más reciente a la más antigua. */
  listByCompany(companyId: string): Promise<LatenessRuleDto[]>;
}
