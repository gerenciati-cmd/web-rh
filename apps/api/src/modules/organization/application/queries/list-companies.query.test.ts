import { TaxId } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Actor, Grant } from '@/shared/application/actor';

import { Company, type CompanyId } from '../../domain/company';
import {
  InMemoryCompanyQueries,
  InMemoryCompanyStore,
} from '../../infrastructure/in-memory/in-memory-company.store';

import { ListCompanies } from './list-companies.query';

const NOW = new Date('2026-01-15T12:00:00Z');

function company(id: string, legalName: string, rfc: string): Company {
  const taxId = TaxId.create('MX', rfc);
  if (!taxId.ok) throw taxId.error;
  const created = Company.create({ id: id as CompanyId, legalName, taxId: taxId.value, now: NOW });
  if (!created.ok) throw created.error;
  return created.value;
}

function actorWith(...grants: Grant[]): Actor {
  return { userId: 'user-1', sessionId: 'session-1', grants };
}

describe('ListCompanies', () => {
  let listCompanies: ListCompanies;

  beforeEach(() => {
    const store = new InMemoryCompanyStore();
    for (const c of [
      company('company-a', 'Alfa SA', 'EKU9003173C9'),
      company('company-b', 'Beta SA', 'AAA010101AAA'),
      company('company-c', 'Gamma SA', 'BBB020202BB2'),
    ]) {
      store.companies.set(c.id, c);
    }
    listCompanies = new ListCompanies({ companyQueries: new InMemoryCompanyQueries(store) });
  });

  const READ = 'organization.companies:read' as const;

  it('concesión de todo el holding: ve todas las empresas', async () => {
    const page = await listCompanies.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: null }),
    });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.id)).toEqual(['company-a', 'company-b', 'company-c']);
  });

  it('concesión de una empresa: solo ve esa', async () => {
    const page = await listCompanies.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: 'company-b' }),
    });

    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.id)).toEqual(['company-b']);
  });

  it('varias empresas: ve exactamente esas, con total y paginación sobre lo visible', async () => {
    const actor = actorWith(
      { permission: READ, companyId: 'company-a' },
      { permission: READ, companyId: 'company-c' },
    );

    const first = await listCompanies.execute({ page: 1, pageSize: 1, actor });
    const second = await listCompanies.execute({ page: 2, pageSize: 1, actor });

    expect(first.total).toBe(2);
    expect(first.items.map((item) => item.id)).toEqual(['company-a']);
    expect(second.items.map((item) => item.id)).toEqual(['company-c']);
  });

  it('sin concesión de ese permiso: lista vacía (otro permiso no cuenta)', async () => {
    const page = await listCompanies.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: 'employees:read', companyId: null }),
    });

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });

  it('una empresa concedida que no existe no aparece ni rompe la consulta', async () => {
    const page = await listCompanies.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: 'company-fantasma' }),
    });

    expect(page.total).toBe(0);
  });
});
