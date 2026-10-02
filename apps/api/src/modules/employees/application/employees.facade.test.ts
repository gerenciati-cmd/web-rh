import { Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { describe, expect, it, vi } from 'vitest';

import { Employee, type EmployeeId } from '../domain/employee';
import { InMemoryEmployeeRepository } from '../infrastructure/in-memory/in-memory-employee.repository';

import { EmployeesFacade } from './employees.facade';
import type { EmployeeQueries, EmployeeRfcOwner, SiteMember } from './queries/employee.queries';

function setup() {
  const employeeRepository = new InMemoryEmployeeRepository();
  const owner: EmployeeRfcOwner = {
    id: 'emp-1',
    companyId: 'company-a',
    fullName: 'Ana Rojas',
    rfc: 'GOMA850101AB1',
    active: true,
  };
  const findByRfcs = vi.fn().mockResolvedValue([owner]);
  const rfcsInCompanies = vi.fn().mockResolvedValue(['GOMA850101AB1']);
  const member: SiteMember = {
    id: 'emp-1',
    companyId: 'company-a',
    fullName: 'Ana Rojas',
    rfc: 'GOMA850101AB1',
  };
  const listActiveOnSite = vi.fn().mockResolvedValue([member]);
  const employeeQueries: EmployeeQueries = {
    listDirectory: vi.fn(),
    findByRfcs,
    rfcsInCompanies,
    listActiveOnSite,
  };
  return {
    employeeRepository,
    listActiveOnSite,
    member,
    findByRfcs,
    rfcsInCompanies,
    owner,
    facade: new EmployeesFacade({ employeeRepository, employeeQueries }),
  };
}

function hired(rfc: string | null) {
  const nationalId = NationalId.create('MX', 'GOMA850101HQRRRN04');
  const email = Email.create('ana@aps.example');
  const parsed = rfc ? PersonalRfc.create(rfc) : null;
  if (!nationalId.ok || !email.ok || (parsed && !parsed.ok)) throw new Error('fixture inválido');
  return Employee.restore('emp-1' as EmployeeId, {
    companyId: 'company-a',
    nationalId: nationalId.value,
    rfc: parsed?.ok ? parsed.value : null,
    siteId: null,
    firstName: 'Ana',
    lastName: 'Rojas',
    email: email.value,
    positionTitle: null,
    hireDate: new Date('2026-01-01T00:00:00Z'),
    status: 'ACTIVE',
  });
}

describe('EmployeesFacade', () => {
  it('findEmployee expone el RFC normalizado', async () => {
    const { facade, employeeRepository } = setup();
    await employeeRepository.save(hired('goma850101ab1'));

    expect(await facade.findEmployee('emp-1')).toMatchObject({
      id: 'emp-1',
      rfc: 'GOMA850101AB1',
      active: true,
    });
  });

  it('findEmployee devuelve rfc null para una fila sin RFC', async () => {
    const { facade, employeeRepository } = setup();
    await employeeRepository.save(hired(null));

    expect((await facade.findEmployee('emp-1'))?.rfc).toBeNull();
  });

  it('findEmployee devuelve siteId null para una fila sin sede', async () => {
    const { facade, employeeRepository } = setup();
    await employeeRepository.save(hired('GOMA850101AB1'));

    expect((await facade.findEmployee('emp-1'))?.siteId).toBeNull();
  });

  it('findEmployee expone la sede del colaborador', async () => {
    const { facade, employeeRepository } = setup();
    const employee = hired('GOMA850101AB1');
    employee.assignSite('site-1', new Date('2026-01-15T12:00:00Z'));
    await employeeRepository.save(employee);

    expect((await facade.findEmployee('emp-1'))?.siteId).toBe('site-1');
  });

  it('listActiveOnSite delega en las queries con la misma sede', async () => {
    const { facade, listActiveOnSite, member } = setup();

    expect(await facade.listActiveOnSite('site-1')).toEqual([member]);
    expect(listActiveOnSite).toHaveBeenCalledWith('site-1');
  });

  it('findEmployee devuelve null si no existe', async () => {
    expect(await setup().facade.findEmployee('nope')).toBeNull();
  });

  it('findByRfcs delega en las queries con los mismos RFC', async () => {
    const { facade, findByRfcs, owner } = setup();

    expect(await facade.findByRfcs(['GOMA850101AB1'])).toEqual([owner]);
    expect(findByRfcs).toHaveBeenCalledWith(['GOMA850101AB1']);
  });

  it('rfcsInCompanies delega en las queries con las mismas empresas', async () => {
    const { facade, rfcsInCompanies } = setup();

    expect(await facade.rfcsInCompanies(['company-a'])).toEqual(['GOMA850101AB1']);
    expect(rfcsInCompanies).toHaveBeenCalledWith(['company-a']);
  });
});
