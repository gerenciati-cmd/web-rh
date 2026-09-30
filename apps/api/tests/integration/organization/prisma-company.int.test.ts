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
  expect((await queries.list({ page: 1, pageSize: 20 }, 'ALL')).total).toBe(1);
});

describe('PrismaCompanyQueries', () => {
  it('lista ordenado por razón social, paginado y con el RFC normalizado', async () => {
    await repository.save(company('Zeta Ltda.', 'AAA010101AAA'));
    await repository.save(company('APS Holding SpA', 'EKU9003173C9'));
    await repository.save(company('Mu SpA', 'BBB020202BB2'));

    const firstPage = await queries.list({ page: 1, pageSize: 2 }, 'ALL');
    const secondPage = await queries.list({ page: 2, pageSize: 2 }, 'ALL');

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.map((c) => c.legalName)).toEqual(['APS Holding SpA', 'Mu SpA']);
    expect(firstPage.items[0]?.taxId).toBe('EKU9003173C9');
    expect(secondPage.items.map((c) => c.legalName)).toEqual(['Zeta Ltda.']);
  });

  it('visible con ids: filtra items y total a esas empresas, y pagina sobre lo visible', async () => {
    const zeta = company('Zeta Ltda.', 'AAA010101AAA');
    const aps = company('APS Holding SpA', 'EKU9003173C9');
    const mu = company('Mu SpA', 'BBB020202BB2');
    for (const c of [zeta, aps, mu]) await repository.save(c);

    const first = await queries.list({ page: 1, pageSize: 1 }, [zeta.id, aps.id]);
    const second = await queries.list({ page: 2, pageSize: 1 }, [zeta.id, aps.id]);

    expect(first.total).toBe(2);
    expect(first.items.map((c) => c.id)).toEqual([aps.id]);
    expect(second.items.map((c) => c.id)).toEqual([zeta.id]);
  });

  it('visible vacío: ninguna empresa; un id inexistente tampoco trae nada', async () => {
    await repository.save(company('APS Holding SpA', 'EKU9003173C9'));

    expect(await queries.list({ page: 1, pageSize: 20 }, [])).toMatchObject({
      items: [],
      total: 0,
    });
    expect(
      await queries.list({ page: 1, pageSize: 20 }, ['00000000-0000-4000-8000-999999999999']),
    ).toMatchObject({ items: [], total: 0 });
  });

  it('findById devuelve null si no existe', async () => {
    expect(await queries.findById('00000000-0000-4000-8000-999999999999')).toBeNull();
  });
});
