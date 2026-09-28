import { Email, NationalId } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { EmployeeAlreadyExistsError } from '@/modules/employees/domain/errors';
import { PrismaEmployeeQueries } from '@/modules/employees/infrastructure/prisma-employee.queries';
import { PrismaEmployeeRepository } from '@/modules/employees/infrastructure/prisma-employee.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['employees.employees']);
const repository = new PrismaEmployeeRepository({ database });
const queries = new PrismaEmployeeQueries({ database });
const ids = new SequentialIdGenerator();

const COMPANY_A = '00000000-0000-4000-8000-00000000000a';
const COMPANY_B = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-01-15T12:00:00Z');

function employee(input: {
  companyId?: string;
  rut: string;
  firstName: string;
  lastName: string;
  hireDate?: string;
}): Employee {
  const nationalId = NationalId.create('CL', input.rut);
  const email = Email.create(`${input.firstName}.${input.lastName}@aps.cl`);
  if (!nationalId.ok || !email.ok) throw new Error('fixture inválido');
  const hired = Employee.hire({
    id: ids.next() as EmployeeId,
    companyId: input.companyId ?? COMPANY_A,
    nationalId: nationalId.value,
    firstName: input.firstName,
    lastName: input.lastName,
    email: email.value,
    hireDate: new Date(`${input.hireDate ?? '2026-01-10'}T00:00:00Z`),
    now: NOW,
  });
  if (!hired.ok) throw hired.error;
  return hired.value;
}

describe('PrismaEmployeeRepository', () => {
  it('guarda y rehidrata sin correr la fecha de contratación (columna DATE)', async () => {
    const ana = employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' });
    await repository.save(ana);

    const found = await repository.findById(ana.id);

    expect(found?.snapshot.hireDate.toISOString()).toBe('2026-01-10T00:00:00.000Z');
    expect(found?.snapshot.nationalId.value).toBe('123456785');
    expect(found?.snapshot.status).toBe('ACTIVE');
  });

  it('persiste la desvinculación', async () => {
    const ana = employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' });
    await repository.save(ana);
    ana.terminate(new Date('2026-02-01T00:00:00Z'), NOW);
    await repository.save(ana);

    expect((await repository.findById(ana.id))?.snapshot.status).toBe('TERMINATED');
  });

  it('existsInCompany está acotado a la empresa', async () => {
    await repository.save(employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' }));
    const rut = NationalId.create('CL', '12345678-5');
    if (!rut.ok) throw rut.error;

    expect(await repository.existsInCompany(COMPANY_A, rut.value)).toBe(true);
    expect(await repository.existsInCompany(COMPANY_B, rut.value)).toBe(false);
  });

  it('el mismo RUT puede existir en otra empresa del holding', async () => {
    await repository.save(employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' }));

    await expect(
      repository.save(
        employee({
          companyId: COMPANY_B,
          rut: '12.345.678-5',
          firstName: 'Ana',
          lastName: 'Rojas',
        }),
      ),
    ).resolves.toEqual({ ok: true, value: undefined });
  });

  it('traduce la violación del índice único (carrera) al conflicto de dominio', async () => {
    await repository.save(employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' }));

    await expect(
      repository.save(employee({ rut: '12.345.678-5', firstName: 'Otra', lastName: 'Persona' })),
    ).resolves.toMatchObject({ ok: false, error: expect.any(EmployeeAlreadyExistsError) });
  });
});

it('dos saves concurrentes conservan una fila por empresa y documento', async () => {
  const results = await Promise.all([
    repository.save(employee({ rut: '12.345.678-5', firstName: 'Fixture', lastName: 'Uno' })),
    repository.save(employee({ rut: '12.345.678-5', firstName: 'Fixture', lastName: 'Dos' })),
  ]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok).map((result) => result.error.code)).toEqual([
    'EMPLOYEE_ALREADY_EXISTS',
  ]);
  expect((await queries.listDirectory({ companyId: COMPANY_A, page: 1, pageSize: 20 })).total).toBe(
    1,
  );
});

describe('PrismaEmployeeQueries.listDirectory', () => {
  async function seed() {
    const pedro = employee({ rut: '7.654.321-6', firstName: 'Pedro', lastName: 'Soto' });
    await repository.save(employee({ rut: '12.345.678-5', firstName: 'Ana', lastName: 'Rojas' }));
    await repository.save(pedro);
    await repository.save(
      employee({ companyId: COMPANY_B, rut: '10.000.013-K', firstName: 'Luis', lastName: 'Araya' }),
    );
    pedro.terminate(new Date('2026-02-01T00:00:00Z'), NOW);
    await repository.save(pedro);
  }

  const page = { page: 1, pageSize: 20 };

  it('solo devuelve colaboradores de la empresa pedida, ordenados por apellido', async () => {
    await seed();

    const result = await queries.listDirectory({ ...page, companyId: COMPANY_A });

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.fullName)).toEqual(['Ana Rojas', 'Pedro Soto']);
    expect(result.items[0]).toMatchObject({ nationalId: '12.345.678-5', hireDate: '2026-01-10' });
  });

  it('filtra por estado', async () => {
    await seed();

    const result = await queries.listDirectory({
      ...page,
      companyId: COMPANY_A,
      status: 'TERMINATED',
    });

    expect(result.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });

  it('busca sin distinguir mayúsculas y por RUT con puntos', async () => {
    await seed();

    const byName = await queries.listDirectory({ ...page, companyId: COMPANY_A, search: 'ROJ' });
    const byRut = await queries.listDirectory({
      ...page,
      companyId: COMPANY_A,
      search: '7.654.321',
    });

    expect(byName.items.map((e) => e.fullName)).toEqual(['Ana Rojas']);
    expect(byRut.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });

  it('pagina y reporta el total del filtro', async () => {
    await seed();

    const result = await queries.listDirectory({ page: 2, pageSize: 1, companyId: COMPANY_A });

    expect(result.total).toBe(2);
    expect(result.items.map((e) => e.fullName)).toEqual(['Pedro Soto']);
  });
});
