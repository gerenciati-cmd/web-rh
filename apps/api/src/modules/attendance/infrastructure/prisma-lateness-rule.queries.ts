import type { LatenessRuleDto } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { LatenessRuleQueries } from '../application/queries/lateness-rule.queries';

import { LatenessRuleMapper } from './lateness-rule.mapper';

export class PrismaLatenessRuleQueries implements LatenessRuleQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listByCompany(companyId: string): Promise<LatenessRuleDto[]> {
    const rows = await this.deps.database.client.attendanceLatenessRule.findMany({
      where: { companyId },
      orderBy: { effectiveFrom: 'desc' },
    });
    return rows.map((row) => LatenessRuleMapper.toDto(row));
  }
}
