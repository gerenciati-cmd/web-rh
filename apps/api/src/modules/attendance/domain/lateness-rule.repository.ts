import type { LatenessRule } from './lateness-rule';

export interface LatenessRuleRepository {
  /** Inserta la regla o, si la empresa ya tiene una en esa `effectiveFrom`, la reemplaza. */
  put(rule: LatenessRule): Promise<void>;
  /** Historial de reglas de la empresa, de la `effectiveFrom` más antigua a la más reciente. */
  listByCompany(companyId: string): Promise<LatenessRule[]>;
}
