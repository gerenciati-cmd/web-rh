import { NationalId } from '@rrhh/domain';
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

function company(legalName: string, rut: string): Company {
  const taxId = NationalId.create('CL', rut);
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
  it('guarda y rehidrata la empresa con su RUT normalizado', async () => {
    const aps = company('APS Holding SpA', '76.086.428-5');
    await repository.save(aps);

    const found = await repository.findById(aps.id);

    expect(found?.legalName).toBe('APS Holding SpA');
    expect(found?.taxId.value).toBe('760864285');
    expect(found?.active).toBe(true);
  });

  it('existsByTaxId distingue RUTs registrados de los que no', async () => {
    await repository.save(company('APS Holding SpA', '76.086.428-5'));

    const registered = NationalId.create('CL', '760864285');
    const other = NationalId.create('CL', '12.345.678-5');
    if (!registered.ok || !other.ok) throw new Error('fixture inválido');

    expect(await repository.existsByTaxId(registered.value)).toBe(true);
    expect(await repository.existsByTaxId(other.value)).toBe(false);
  });

  it('traduce la violación del índice único (carrera) al conflicto de dominio', async () => {
    await repository.save(company('APS Holding SpA', '76.086.428-5'));

    await expect(repository.save(company('Duplicada', '76.086.428-5'))).rejects.toBeInstanceOf(
      CompanyAlreadyExistsError,
    );
  });
});

describe('PrismaCompanyQueries', () => {
  it('lista ordenado por razón social, paginado y con el RUT formateado', async () => {
    await repository.save(company('Zeta Ltda.', '12.345.678-5'));
    await repository.save(company('APS Holding SpA', '76.086.428-5'));
    await repository.save(company('Mu SpA', '7.654.321-6'));

    const firstPage = await queries.list({ page: 1, pageSize: 2 });
    const secondPage = await queries.list({ page: 2, pageSize: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.items.map((c) => c.legalName)).toEqual(['APS Holding SpA', 'Mu SpA']);
    expect(firstPage.items[0]?.taxId).toBe('76.086.428-5');
    expect(secondPage.items.map((c) => c.legalName)).toEqual(['Zeta Ltda.']);
  });

  it('findById devuelve null si no existe', async () => {
    expect(await queries.findById('00000000-0000-4000-8000-999999999999')).toBeNull();
  });
});
