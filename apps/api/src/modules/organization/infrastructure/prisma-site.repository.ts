import { err, ok, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import { SiteAlreadyExistsError } from '../domain/errors';
import { siteNameKey, type Site, type SiteId } from '../domain/site';
import type { SiteRepository } from '../domain/site.repository';

import { SiteMapper } from './site.mapper';

export class PrismaSiteRepository implements SiteRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: SiteId): Promise<Site | null> {
    const row = await this.deps.database.client.site.findUnique({ where: { id } });
    return row ? SiteMapper.toDomain(row) : null;
  }

  async existsByName(name: string): Promise<boolean> {
    const count = await this.deps.database.client.site.count({
      where: { nameKey: siteNameKey(name) },
    });
    return count > 0;
  }

  async save(site: Site): Promise<Result<void, SiteAlreadyExistsError>> {
    const data = SiteMapper.toPersistence(site);
    try {
      await this.deps.database.client.site.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      return ok(undefined);
    } catch (error) {
      // Carrera entre dos requests que pasaron el `existsByName`: el índice único decide.
      if (isUniqueViolation(error)) return err(new SiteAlreadyExistsError(site.name));
      throw error;
    }
  }
}
