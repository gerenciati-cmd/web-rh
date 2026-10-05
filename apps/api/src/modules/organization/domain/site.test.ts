import { describe, expect, it } from 'vitest';

import { Site, SITE_CREATED, siteNameKey, type SiteId } from './site';

const NOW = new Date('2026-01-15T12:00:00Z');
const ID = '00000000-0000-4000-8000-000000000001' as SiteId;

const valid = {
  id: ID,
  name: 'Cancún Centro',
  country: 'MX' as const,
  timeZone: 'America/Cancun',
  now: NOW,
};

describe('Site', () => {
  it('crea la sede activa y registra SITE_CREATED', () => {
    const result = Site.create(valid);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.active).toBe(true);
    expect(result.value.createdAt).toEqual(NOW);
    expect(result.value.timeZone).toBe('America/Cancun');
    const events = result.value.pullEvents();
    expect(events.map((event) => event.name)).toEqual([SITE_CREATED]);
    expect(events[0]?.payload).toEqual({ siteId: ID, country: 'MX' });
  });

  it('recorta el nombre', () => {
    const result = Site.create({ ...valid, name: '  Cancún Centro  ' });
    expect(result.ok && result.value.name).toBe('Cancún Centro');
  });

  it.each([['a'], ['   '], ['a'.repeat(101)]])('rechaza el nombre %j', (name) => {
    const result = Site.create({ ...valid, name });
    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('acepta nombres de 2 y de 100 caracteres', () => {
    expect(Site.create({ ...valid, name: 'ab' }).ok).toBe(true);
    expect(Site.create({ ...valid, name: 'a'.repeat(100) }).ok).toBe(true);
  });

  it('rechaza una zona que no es del país', () => {
    const result = Site.create({ ...valid, timeZone: 'America/Bogota' });
    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('siteNameKey iguala mayúsculas, espacios extremos y acentos NFC/NFD', () => {
    expect(siteNameKey('  CANCÚN Centro '.normalize('NFD'))).toBe(siteNameKey('cancún centro'));
    expect(siteNameKey('Cancún'.normalize('NFD'))).toBe('cancún'.normalize('NFC'));
  });

  it('restore no emite eventos', () => {
    const site = Site.restore(ID, {
      name: 'X1',
      country: 'CO',
      timeZone: 'America/Bogota',
      active: false,
      createdAt: NOW,
    });
    expect(site.active).toBe(false);
    expect(site.pullEvents()).toEqual([]);
  });
});
