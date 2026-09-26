import { beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { CompanyCreated } from '../../domain/company';
import {
  InMemoryCompanyRepository,
  InMemoryCompanyStore,
} from '../../infrastructure/in-memory/in-memory-company.store';

import { CreateCompany } from './create-company.command';

describe('CreateCompany', () => {
  let store: InMemoryCompanyStore;
  let eventBus: RecordingEventBus;
  let createCompany: CreateCompany;

  beforeEach(() => {
    store = new InMemoryCompanyStore();
    eventBus = new RecordingEventBus();
    createCompany = new CreateCompany({
      companyRepository: new InMemoryCompanyRepository(store),
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

  it('crea la empresa y publica CompanyCreated', async () => {
    const result = await createCompany.execute(validInput);

    expect(result.ok).toBe(true);
    expect(store.companies.size).toBe(1);
    expect(eventBus.names()).toEqual([CompanyCreated]);
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
});
