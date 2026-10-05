import type { Page, PageQuery, SiteDto } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { SiteQueries } from '../application/queries/site.queries';

import { SiteMapper } from './site.mapper';

const SITE_SELECT = {
  id: true,
  name: true,
  country: true,
  timeZone: true,
  active: true,
  createdAt: true,
} as const;

export class PrismaSiteQueries implements SiteQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async list({ page, pageSize }: PageQuery): Promise<Page<SiteDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.site.findMany({
        select: SITE_SELECT,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.site.count(),
    ]);
    return { items: rows.map((row) => SiteMapper.toDto(row)), total, page, pageSize };
  }

  async findById(id: string): Promise<SiteDto | null> {
    const row = await this.deps.database.client.site.findUnique({
      where: { id },
      select: SITE_SELECT,
    });
    return row ? SiteMapper.toDto(row) : null;
  }
}
