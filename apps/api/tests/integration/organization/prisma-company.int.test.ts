import { TaxId } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Company, type CompanyId } from '@/modules/organization/domain/company';
import { CompanyAlreadyExistsError } from '@/modules/organization/domain/errors';
import { PrismaCompanyQueries } from '@/modules/organization/infrastructure/prisma-company.queries';
import { PrismaCompanyRepository } from '@/modules/organization/infrastructure/prisma-company.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['organization.companies']);
const repository = new PrismaCompanyRepository({ database });
const queries = new PrismaCompanyQueries({ database });
const ids = new SequentialIdGenerator();

function company(legalName: string, rfc: string): Company {
  const taxId = TaxId.create('MX', rfc);
  if (!taxId.ok) throw taxId.error;
  const created = Company.create({
    id: ids.next() as CompanyId,
    legalName,
    taxId: taxId.value,
    now: new Date('2026-01-15T12:00:00Z'),
  });
  if (!created.ok) throw created.error;
  return created.value;
}

describe('PrismaCompanyRepository', () => {
  it('guarda y rehidrata la empresa con su RFC normalizado', async () => {
    const aps = company('APS Holding SpA', 'EKU9003173C9');
    await repository.save(aps);

    const found = await repository.findById(aps.id);

    expect(found?.legalName).toBe('APS Holding SpA');
    expect(found?.taxId.value).toBe('EKU9003173C9');
    expect(found?.active).toBe(true);
  });

  it('existsByTaxId distingue RFCs registrados de los que no', async () => {
    await repository.save(company('APS Holding SpA', 'EKU9003173C9'));

    const registered = TaxId.create('MX', 'eku9003173c9');
    const other = TaxId.create('MX', 'AAA010101AAA');
    if (!registered.ok || !other.ok) throw new Error('fixture inválido');

    expect(await repository.existsByTaxId(registered.value)).toBe(true);
    expect(await repository.existsByTaxId(other.value)).toBe(false);
  });

  it('traduce la violación del índice único (carrera) al conflicto de dominio', async () => {
    await repository.save(company('APS Holding SpA', 'EKU9003173C9'));

    const result = await repository.save(company('Duplicada', 'EKU9003173C9'));
    expect(!result.ok && result.error).toBeInstanceOf(CompanyAlreadyExistsError);
  });
});

it('dos saves concurrentes conservan una fila y devuelven un conflicto', async () => {
  const results = await Promise.all([
    repository.save(company('Fixture Uno', 'EKU9003173C9')),
    repository.save(company('Fixture Dos', 'EKU9003173C9')),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
    'COMPANY_ALREADY_EXISTS',
  ]);
  expect((await queries.list({ page: 1, pageSize: 20 })).total).toBe(1);
});

describe('PrismaCompanyQueries', () => {
  it('lista ordenado por razón social, paginado y con el RFC normalizado', async () => {
    await repository.save(company('Zeta Ltda.', 'AAA010101AAA'));
    await repository.save(company('APS Holding SpA', 'EKU9003173C9'));
    await repository.save(company('Mu SpA', 'BBB020202BB2'));

    const firstPage = await queries.list({ page: 1, pageSize: 2 });
    const secondPage = await queries.list({ page: 2, pageSize: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.map((c) => c.legalName)).toEqual(['APS Holding SpA', 'Mu SpA']);
    expect(firstPage.items[0]?.taxId).toBe('EKU9003173C9');
    expect(secondPage.items.map((c) => c.legalName)).toEqual(['Zeta Ltda.']);
  });

  it('findById devuelve null si no existe', async () => {
    expect(await queries.findById('00000000-0000-4000-8000-999999999999')).toBeNull();
  });
});
