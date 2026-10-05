import { err } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { SiteAlreadyExistsError } from '../../domain/errors';
import { SITE_CREATED } from '../../domain/site';
import {
  InMemorySiteRepository,
  InMemorySiteStore,
} from '../../infrastructure/in-memory/in-memory-site.store';

import { CreateSite } from './create-site.command';

describe('CreateSite', () => {
  let repository: InMemorySiteRepository;
  let store: InMemorySiteStore;
  let eventBus: RecordingEventBus;
  let createSite: CreateSite;

  beforeEach(() => {
    store = new InMemorySiteStore();
    repository = new InMemorySiteRepository(store);
    eventBus = new RecordingEventBus();
    createSite = new CreateSite({
      siteRepository: repository,
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const validInput = {
    name: 'Cancún Centro',
    country: 'MX' as const,
    timeZone: 'America/Cancun',
  };

  it('crea la sede y publica SITE_CREATED', async () => {
    const result = await createSite.execute(validInput);

    expect(result.ok).toBe(true);
    expect(store.sites.size).toBe(1);
    expect(eventBus.names()).toEqual([SITE_CREATED]);
  });

  it('rechaza un nombre repetido sin distinguir mayúsculas ni espacios extremos', async () => {
    await createSite.execute(validInput);
    const result = await createSite.execute({ ...validInput, name: '  CANCÚN centro ' });

    expect(!result.ok && result.error.code).toBe('SITE_ALREADY_EXISTS');
    expect(store.sites.size).toBe(1);
    expect(eventBus.names()).toEqual([SITE_CREATED]);
  });

  it('rechaza el mismo nombre escrito con el acento como carácter aparte (NFD)', async () => {
    await createSite.execute(validInput);
    const result = await createSite.execute({
      ...validInput,
      name: validInput.name.normalize('NFD'),
    });

    expect(!result.ok && result.error.code).toBe('SITE_ALREADY_EXISTS');
    expect(store.sites.size).toBe(1);
  });

  it('rechaza una zona que no es del país sin persistir', async () => {
    const result = await createSite.execute({ ...validInput, timeZone: 'America/Bogota' });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(store.sites.size).toBe(0);
    expect(eventBus.names()).toEqual([]);
  });

  it('propaga conflicto de save sin publicar evento', async () => {
    vi.spyOn(repository, 'save').mockResolvedValue(err(new SiteAlreadyExistsError('Cancún')));
    const result = await createSite.execute(validInput);

    expect(!result.ok && result.error.code).toBe('SITE_ALREADY_EXISTS');
    expect(eventBus.names()).toEqual([]);
  });

  it('no convierte fallos inesperados en conflicto', async () => {
    const failure = new Error('persistencia no disponible');
    vi.spyOn(repository, 'save').mockRejectedValue(failure);

    await expect(createSite.execute(validInput)).rejects.toBe(failure);
    expect(eventBus.names()).toEqual([]);
  });
});
