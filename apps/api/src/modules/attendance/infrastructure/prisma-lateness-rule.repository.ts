import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { LatenessRule } from '../domain/lateness-rule';
import type { LatenessRuleRepository } from '../domain/lateness-rule.repository';

import { LatenessRuleMapper } from './lateness-rule.mapper';

export class PrismaLatenessRuleRepository implements LatenessRuleRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async put(rule: LatenessRule): Promise<void> {
    const effectiveFrom = new Date(`${rule.effectiveFrom}T00:00:00Z`);
    await this.deps.database.client.attendanceLatenessRule.upsert({
      where: { companyId_effectiveFrom: { companyId: rule.companyId, effectiveFrom } },
      create: {
        companyId: rule.companyId,
        effectiveFrom,
        threshold: rule.threshold,
        period: rule.period,
        setAt: rule.setAt,
        setBy: rule.setBy,
      },
      update: {
        threshold: rule.threshold,
        period: rule.period,
        setAt: rule.setAt,
        setBy: rule.setBy,
      },
    });
  }

  async listByCompany(companyId: string): Promise<LatenessRule[]> {
    const rows = await this.deps.database.client.attendanceLatenessRule.findMany({
      where: { companyId },
      orderBy: { effectiveFrom: 'asc' },
    });
    return rows.map((row) => LatenessRuleMapper.toDomain(row));
  }
}
