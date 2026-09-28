import { err } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { COMPANY_CREATED } from '../../domain/company';
import { CompanyAlreadyExistsError } from '../../domain/errors';
import {
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '../../infrastructure/in-memory/in-memory-company.store';

import { CreateCompany } from './create-company.command';

describe('CreateCompany', () => {
  let repository: InMemoryCompanyRepository;
  let store: InMemoryCompanyStore;
  let eventBus: RecordingEventBus;
  let createCompany: CreateCompany;

  beforeEach(() => {
    store = new InMemoryCompanyStore();
    repository = new InMemoryCompanyRepository(store);
    eventBus = new RecordingEventBus();
    createCompany = new CreateCompany({
      companyRepository: repository,
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(),
      eventBus,
    });
  });

  const validInput = {
    legalName: 'APS Holding SpA',
    taxId: '76.086.428-5',
    country: 'CL' as const,
  };

  it('crea la empresa y publica COMPANY_CREATED', async () => {
    const result = await createCompany.execute(validInput);

    expect(result.ok).toBe(true);
    expect(store.companies.size).toBe(1);
    expect(eventBus.names()).toEqual([COMPANY_CREATED]);
  });

  it('rechaza un identificador tributario inválido sin persistir', async () => {
    const result = await createCompany.execute({ ...validInput, taxId: '76.086.428-0' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(store.companies.size).toBe(0);
  });

  it('rechaza duplicados aunque el RUT venga con otro formato', async () => {
    await createCompany.execute(validInput);
    const result = await createCompany.execute({ ...validInput, taxId: '760864285' });

    expect(!result.ok && result.error.code).toBe('COMPANY_ALREADY_EXISTS');
  });

  it('propaga conflicto de save sin publicar evento', async () => {
    vi.spyOn(repository, 'save').mockResolvedValue(err(new CompanyAlreadyExistsError('123456785')));
    const result = await createCompany.execute(validInput);
    expect(!result.ok && result.error.code).toBe('COMPANY_ALREADY_EXISTS');
    expect(eventBus.names()).toEqual([]);
  });
  it('no convierte fallos inesperados en conflicto', async () => {
    const failure = new Error('persistencia no disponible');
    vi.spyOn(repository, 'save').mockRejectedValue(failure);
    await expect(createCompany.execute(validInput)).rejects.toBe(failure);
    expect(eventBus.names()).toEqual([]);
  });
  it('dos comandos concurrentes persisten uno y publican un evento', async () => {
    const results = await Promise.all([
      createCompany.execute(validInput),
      createCompany.execute(validInput),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      results.filter((result) => !result.ok && result.error.code === 'COMPANY_ALREADY_EXISTS'),
    ).toHaveLength(1);
    expect(eventBus.names()).toHaveLength(1);
  });
});
