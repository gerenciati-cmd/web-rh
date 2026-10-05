import { describe, expect, it } from 'vitest';

import { Site, type SiteId } from '../../domain/site';
import {
  InMemorySiteQueries,
  InMemorySiteStore,
} from '../../infrastructure/in-memory/in-memory-site.store';

import { ListSites } from './list-sites.query';

function site(id: string, name: string): Site {
  const created = Site.create({
    id: id as SiteId,
    name,
    country: 'MX',
    timeZone: 'America/Cancun',
    now: new Date('2026-01-15T12:00:00Z'),
  });
  if (!created.ok) throw created.error;
  return created.value;
}

describe('ListSites', () => {
  const build = (): ListSites => {
    const store = new InMemorySiteStore();
    for (const s of [site('s-c', 'Gamma'), site('s-a', 'Alfa'), site('s-b', 'Beta')]) {
      store.sites.set(s.id, s);
    }
    return new ListSites({ siteQueries: new InMemorySiteQueries(store) });
  };

  it('lista todas las sedes ordenadas por nombre, sin filtro por empresa', async () => {
    const page = await build().execute({ page: 1, pageSize: 20 });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.name)).toEqual(['Alfa', 'Beta', 'Gamma']);
    expect(page.items[0]).toMatchObject({ active: true, country: 'MX' });
  });

  it('pagina con total sobre todo el catálogo', async () => {
    const second = await build().execute({ page: 2, pageSize: 2 });

    expect(second.total).toBe(3);
    expect(second.items.map((item) => item.name)).toEqual(['Gamma']);
  });

  it('catálogo vacío: página vacía', async () => {
    const empty = new ListSites({ siteQueries: new InMemorySiteQueries(new InMemorySiteStore()) });
    expect(await empty.execute({ page: 1, pageSize: 20 })).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
    });
  });
});
