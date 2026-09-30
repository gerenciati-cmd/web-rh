import type { CompanyDto, Page, PageQuery } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { CompanyQueries } from '../application/queries/company.queries';

import { CompanyMapper } from './company.mapper';

const COMPANY_SELECT = {
  id: true,
  legalName: true,
  taxId: true,
  country: true,
  active: true,
  createdAt: true,
} as const;

export class PrismaCompanyQueries implements CompanyQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async list(
    { page, pageSize }: PageQuery,
    visible: 'ALL' | readonly string[],
  ): Promise<Page<CompanyDto>> {
    const db = this.deps.database.client;
    const where = visible === 'ALL' ? {} : { id: { in: [...visible] } };
    const [rows, total] = await Promise.all([
      db.company.findMany({
        where,
        select: COMPANY_SELECT,
        orderBy: { legalName: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.company.count({ where }),
    ]);
    return { items: rows.map((row) => CompanyMapper.toDto(row)), total, page, pageSize };
  }

  async findById(id: string): Promise<CompanyDto | null> {
    const row = await this.deps.database.client.company.findUnique({
      where: { id },
      select: COMPANY_SELECT,
    });
    return row ? CompanyMapper.toDto(row) : null;
  }
}
