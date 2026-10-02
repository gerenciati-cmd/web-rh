import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { EmployeesPunchOwnerDirectory } from '@/modules/attendance/infrastructure/employees-punch-owner-directory';
import { EmployeesFacade } from '@/modules/employees/application/employees.facade';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { PrismaEmployeeQueries } from '@/modules/employees/infrastructure/prisma-employee.queries';
import { PrismaEmployeeRepository } from '@/modules/employees/infrastructure/prisma-employee.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

/**
 * El adaptador de attendance sobre los adaptadores REALES de employees (fachada + Prisma), sin
 * dobles: lo que el contenedor de producción cablea.
 */
const database = useTestDatabase(['employees.employees']);
const repository = new PrismaEmployeeRepository({ database });
const directory = new EmployeesPunchOwnerDirectory({
  employeesApi: new EmployeesFacade({
    employeeRepository: repository,
    employeeQueries: new PrismaEmployeeQueries({ database }),
  }),
});
const ids = new SequentialIdGenerator();

const COMPANY_A = '00000000-0000-4000-8000-00000000000a';
const COMPANY_B = '00000000-0000-4000-8000-00000000000b';
const NOW = new Date('2026-01-15T12:00:00Z');

async function hire(input: {
  companyId: string;
  curp: string;
  rfc: string;
  firstName: string;
  lastName: string;
}): Promise<Employee> {
  const nationalId = NationalId.create('MX', input.curp);
  const email = Email.create(`${input.firstName}.${input.lastName}@aps.example`);
  const rfc = PersonalRfc.create(input.rfc);
  if (!nationalId.ok || !email.ok || !rfc.ok) throw new Error('fixture inválido');
  const hired = Employee.hire({
    id: ids.next() as EmployeeId,
    companyId: input.companyId,
    nationalId: nationalId.value,
    rfc: rfc.value,
    siteId: '019b1c2e-0000-7000-8000-000000000001',
    firstName: input.firstName,
    lastName: input.lastName,
    email: email.value,
    hireDate: new Date('2026-01-10T00:00:00Z'),
    now: NOW,
  });
  if (!hired.ok) throw hired.error;
  const saved = await repository.save(hired.value);
  if (!saved.ok) throw saved.error;
  return hired.value;
}

const ANA = {
  companyId: COMPANY_A,
  curp: 'GOMA850101HQRRRN04',
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
};
const LUIS = {
  companyId: COMPANY_B,
  curp: 'ROSA010305HQRDNLA3',
  rfc: 'ROSA010305AB1',
  firstName: 'Luis',
  lastName: 'Antiguo',
};

describe('EmployeesPunchOwnerDirectory con la BD real', () => {
  it('ownersOf devuelve el dueño por PIN y omite los PIN sin colaborador', async () => {
    const ana = await hire(ANA);
    await hire(LUIS);

    const owners = await directory.ownersOf([ANA.rfc, '1']);

    expect([...owners]).toEqual([
      [ANA.rfc, { employeeId: ana.id, companyId: COMPANY_A, fullName: 'Ana Rojas' }],
    ]);
  });

  it('ownersOf sin PIN devuelve un mapa vacío', async () => {
    await hire(ANA);

    expect((await directory.ownersOf([])).size).toBe(0);
  });

  it('un colaborador desvinculado sigue siendo dueño de su PIN', async () => {
    const ana = await hire(ANA);
    ana.terminate(new Date('2026-02-01T00:00:00Z'), NOW);
    await repository.save(ana);

    const owners = await directory.ownersOf([ANA.rfc]);

    expect(owners.get(ANA.rfc)?.employeeId).toBe(ana.id);
  });

  it('pinsOfCompanies trae solo los RFC de esas empresas; sin empresas devuelve []', async () => {
    await hire(ANA);
    await hire(LUIS);

    expect(await directory.pinsOfCompanies([COMPANY_A])).toEqual([ANA.rfc]);
    expect((await directory.pinsOfCompanies([COMPANY_A, COMPANY_B])).sort()).toEqual([
      ANA.rfc,
      LUIS.rfc,
    ]);
    expect(await directory.pinsOfCompanies([])).toEqual([]);
  });
});
