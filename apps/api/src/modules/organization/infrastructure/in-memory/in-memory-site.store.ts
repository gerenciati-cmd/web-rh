import type { Page, PageQuery, SiteDto } from '@rrhh/contracts';
import { err, ok, type Result } from '@rrhh/domain';

import type { SiteQueries } from '../../application/queries/site.queries';
import { SiteAlreadyExistsError } from '../../domain/errors';
import type { Site, SiteId } from '../../domain/site';
import type { SiteRepository } from '../../domain/site.repository';

/**
 * Adaptadores en memoria para tests. Cumplen los MISMOS contratos que la versión Prisma.
 * Repositorio y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemorySiteStore {
  readonly sites = new Map<string, Site>();
}

const keyOf = (name: string): string => name.trim().toLowerCase();

export class InMemorySiteRepository implements SiteRepository {
  constructor(private readonly store: InMemorySiteStore) {}

  findById(id: SiteId): Promise<Site | null> {
    return Promise.resolve(this.store.sites.get(id) ?? null);
  }

  existsByName(name: string): Promise<boolean> {
    const key = keyOf(name);
    return Promise.resolve([...this.store.sites.values()].some((site) => keyOf(site.name) === key));
  }

  save(site: Site): Promise<Result<void, SiteAlreadyExistsError>> {
    const key = keyOf(site.name);
    const duplicate = [...this.store.sites.values()].some(
      (other) => other.id !== site.id && keyOf(other.name) === key,
    );
    if (duplicate) return Promise.resolve(err(new SiteAlreadyExistsError(site.name)));
    this.store.sites.set(site.id, site);
    return Promise.resolve(ok(undefined));
  }
}

export class InMemorySiteQueries implements SiteQueries {
  constructor(private readonly store: InMemorySiteStore) {}

  list({ page, pageSize }: PageQuery): Promise<Page<SiteDto>> {
    const all = [...this.store.sites.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map(toDto);
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  findById(id: string): Promise<SiteDto | null> {
    const site = this.store.sites.get(id);
    return Promise.resolve(site ? toDto(site) : null);
  }
}

function toDto(site: Site): SiteDto {
  return {
    id: site.id,
    name: site.name,
    country: site.country,
    timeZone: site.timeZone,
    active: site.active,
    createdAt: site.createdAt.toISOString(),
  };
}
