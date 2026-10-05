import { describe, expect, it } from 'vitest';

import { SiteAlreadyExistsError } from '@/modules/organization/domain/errors';
import { Site, type SiteId } from '@/modules/organization/domain/site';
import { PrismaSiteQueries } from '@/modules/organization/infrastructure/prisma-site.queries';
import { PrismaSiteRepository } from '@/modules/organization/infrastructure/prisma-site.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['organization.sites']);
const repository = new PrismaSiteRepository({ database });
const queries = new PrismaSiteQueries({ database });
const ids = new SequentialIdGenerator();

function site(name: string, country: 'MX' | 'DO' = 'MX', timeZone = 'America/Cancun'): Site {
  const created = Site.create({
    id: ids.next() as SiteId,
    name,
    country,
    timeZone,
    now: new Date('2026-01-15T12:00:00Z'),
  });
  if (!created.ok) throw created.error;
  return created.value;
}

describe('PrismaSiteRepository', () => {
  it('guarda y rehidrata la sede', async () => {
    const cancun = site('Cancún Centro');
    await repository.save(cancun);

    const found = await repository.findById(cancun.id);

    expect(found?.name).toBe('Cancún Centro');
    expect(found?.country).toBe('MX');
    expect(found?.timeZone).toBe('America/Cancun');
    expect(found?.active).toBe(true);
    expect(found?.createdAt).toEqual(new Date('2026-01-15T12:00:00Z'));
  });

  it('findById devuelve null si no existe', async () => {
    expect(await repository.findById('00000000-0000-4000-8000-999999999999' as SiteId)).toBeNull();
  });

  it('existsByName ignora mayúsculas y espacios extremos', async () => {
    await repository.save(site('Cancún Centro'));

    expect(await repository.existsByName('  CANCÚN centro ')).toBe(true);
    expect(await repository.existsByName('Mérida')).toBe(false);
  });

  it('el índice único de name_key traduce el duplicado (otra capitalización) a conflicto', async () => {
    await repository.save(site('Cancún Centro'));

    const result = await repository.save(site('cancún centro'));

    expect(!result.ok && result.error).toBeInstanceOf(SiteAlreadyExistsError);
    expect((await queries.list({ page: 1, pageSize: 20 })).total).toBe(1);
  });

  it('dos saves concurrentes conservan una fila y devuelven un conflicto', async () => {
    const results = await Promise.all([
      repository.save(site('Sede Carrera')),
      repository.save(site('SEDE CARRERA')),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
      'SITE_ALREADY_EXISTS',
    ]);
  });
});

describe('PrismaSiteQueries', () => {
  it('lista ordenado por nombre y pagina con total', async () => {
    await repository.save(site('Zeta'));
    await repository.save(site('Alfa'));
    await repository.save(site('Mu'));

    const first = await queries.list({ page: 1, pageSize: 2 });
    const second = await queries.list({ page: 2, pageSize: 2 });

    expect(first.total).toBe(3);
    expect(first.items.map((s) => s.name)).toEqual(['Alfa', 'Mu']);
    expect(second.items.map((s) => s.name)).toEqual(['Zeta']);
    expect(first.items[0]).toMatchObject({ active: true, country: 'MX' });
    expect(first.items[0]?.createdAt).toBe('2026-01-15T12:00:00.000Z');
  });

  it('findById devuelve el DTO o null', async () => {
    const dominicana = site('Santo Domingo', 'DO', 'America/Santo_Domingo');
    await repository.save(dominicana);

    expect(await queries.findById(dominicana.id)).toMatchObject({
      id: dominicana.id,
      country: 'DO',
      timeZone: 'America/Santo_Domingo',
    });
    expect(await queries.findById('00000000-0000-4000-8000-999999999999')).toBeNull();
  });
});
