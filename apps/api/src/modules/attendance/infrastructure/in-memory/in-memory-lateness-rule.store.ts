import type { LatenessRuleDto } from '@rrhh/contracts';

import type { LatenessRuleQueries } from '../../application/queries/lateness-rule.queries';
import type { LatenessRule } from '../../domain/lateness-rule';
import type { LatenessRuleRepository } from '../../domain/lateness-rule.repository';

/**
 * Adaptadores en memoria de reglas de retardos para tests. Cumplen los MISMOS contratos que la
 * versión Prisma; repositorio y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemoryLatenessRuleStore {
  /** Clave `companyId|effectiveFrom`. */
  readonly rules = new Map<string, LatenessRule>();
}

function byEffectiveFrom(a: LatenessRule, b: LatenessRule): number {
  return a.effectiveFrom < b.effectiveFrom ? -1 : a.effectiveFrom > b.effectiveFrom ? 1 : 0;
}

export class InMemoryLatenessRuleRepository implements LatenessRuleRepository {
  constructor(private readonly store: InMemoryLatenessRuleStore) {}

  put(rule: LatenessRule): Promise<void> {
    this.store.rules.set(`${rule.companyId}|${rule.effectiveFrom}`, { ...rule });
    return Promise.resolve();
  }

  listByCompany(companyId: string): Promise<LatenessRule[]> {
    return Promise.resolve(
      [...this.store.rules.values()]
        .filter((rule) => rule.companyId === companyId)
        .sort(byEffectiveFrom)
        .map((rule) => ({ ...rule })),
    );
  }
}

export class InMemoryLatenessRuleQueries implements LatenessRuleQueries {
  constructor(private readonly store: InMemoryLatenessRuleStore) {}

  listByCompany(companyId: string): Promise<LatenessRuleDto[]> {
    return Promise.resolve(
      [...this.store.rules.values()]
        .filter((rule) => rule.companyId === companyId)
        .sort((a, b) => byEffectiveFrom(b, a))
        .map((rule): LatenessRuleDto => ({
          effectiveFrom: rule.effectiveFrom,
          threshold: rule.threshold,
          period: rule.period,
          setAt: rule.setAt.toISOString(),
        })),
    );
  }
}
