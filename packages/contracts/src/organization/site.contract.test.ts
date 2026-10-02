import { describe, expect, it } from 'vitest';

import { CreateSiteSchema, siteRoutes } from './site.contract';

describe('CreateSiteSchema', () => {
  const base = { name: 'Cancún Centro', country: 'MX', timeZone: 'America/Cancun' };

  it('acepta una sede válida', () => {
    expect(CreateSiteSchema.safeParse(base).success).toBe(true);
  });

  it('acepta una sede dominicana con su zona', () => {
    const result = CreateSiteSchema.safeParse({
      name: 'Santo Domingo',
      country: 'DO',
      timeZone: 'America/Santo_Domingo',
    });
    expect(result.success).toBe(true);
  });

  it('rechaza una zona de otro país con el error en timeZone', () => {
    const result = CreateSiteSchema.safeParse({ ...base, timeZone: 'America/Bogota' });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['timeZone']);
  });

  it('rechaza una zona inventada', () => {
    expect(CreateSiteSchema.safeParse({ ...base, timeZone: 'Mars/Olympus' }).success).toBe(false);
  });

  it('rechaza un país no soportado', () => {
    expect(CreateSiteSchema.safeParse({ ...base, country: 'CL' }).success).toBe(false);
  });

  it('recorta el nombre y la zona', () => {
    const result = CreateSiteSchema.safeParse({
      name: '  Cancún Centro  ',
      country: 'MX',
      timeZone: ' America/Cancun ',
    });
    expect(result.success && result.data).toMatchObject({
      name: 'Cancún Centro',
      timeZone: 'America/Cancun',
    });
  });

  it.each([
    ['1 carácter', 'a', false],
    ['2 caracteres', 'ab', true],
    ['100 caracteres', 'a'.repeat(100), true],
    ['101 caracteres', 'a'.repeat(101), false],
    ['solo espacios', '   ', false],
  ])('nombre de %s', (_label, name, valid) => {
    expect(CreateSiteSchema.safeParse({ ...base, name }).success).toBe(valid);
  });
});

describe('siteRoutes', () => {
  it('listar exige organization.sites:read', () => {
    expect(siteRoutes.listSites.access).toEqual({
      kind: 'permission',
      permission: 'organization.sites:read',
    });
  });

  it('crear exige organization.sites:manage y responde 201', () => {
    expect(siteRoutes.createSite.access).toEqual({
      kind: 'permission',
      permission: 'organization.sites:manage',
    });
    expect(siteRoutes.createSite.successStatus).toBe(201);
  });
});
