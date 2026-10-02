import { describe, expect, it } from 'vitest';

import { Site, type SiteId } from '../domain/site';
import {
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '../infrastructure/in-memory/in-memory-company.store';
import {
  InMemorySiteRepository,
  InMemorySiteStore,
} from '../infrastructure/in-memory/in-memory-site.store';

import { OrganizationFacade } from './organization.facade';

describe('OrganizationFacade.findSite', () => {
  const build = () => {
    const sites = new InMemorySiteStore();
    const facade = new OrganizationFacade({
      companyRepository: new InMemoryCompanyRepository(new InMemoryCompanyStore()),
      siteRepository: new InMemorySiteRepository(sites),
    });
    return { sites, facade };
  };

  it('devuelve el resumen mínimo de la sede', async () => {
    const { sites, facade } = build();
    const created = Site.create({
      id: 'site-1' as SiteId,
      name: 'Cancún Centro',
      country: 'MX',
      timeZone: 'America/Cancun',
      now: new Date('2026-01-15T12:00:00Z'),
    });
    if (!created.ok) throw created.error;
    sites.sites.set(created.value.id, created.value);

    expect(await facade.findSite('site-1')).toEqual({
      id: 'site-1',
      name: 'Cancún Centro',
      country: 'MX',
      timeZone: 'America/Cancun',
      active: true,
    });
  });

  it('devuelve null si la sede no existe', async () => {
    expect(await build().facade.findSite('no-existe')).toBeNull();
  });
});
