import { describe, expect, it, vi } from 'vitest';

import type { EmployeesApi } from '@/modules/employees';

import { EmployeesPunchOwnerDirectory } from './employees-punch-owner-directory';

function setup() {
  const findByRfcs = vi.fn<EmployeesApi['findByRfcs']>();
  const rfcsInCompanies = vi.fn<EmployeesApi['rfcsInCompanies']>();
  const findEmployee = vi.fn<EmployeesApi['findEmployee']>();
  const directory = new EmployeesPunchOwnerDirectory({
    employeesApi: { findEmployee, findByRfcs, rfcsInCompanies, listActiveOnSite: vi.fn() },
  });
  return { directory, findByRfcs, rfcsInCompanies };
}

describe('EmployeesPunchOwnerDirectory', () => {
  it('ownersOf indexa por RFC (el PIN) y traduce al vocabulario de attendance', async () => {
    const { directory, findByRfcs } = setup();
    findByRfcs.mockResolvedValue([
      {
        id: 'emp-1',
        companyId: 'co-1',
        fullName: 'Ana Rojas',
        rfc: 'GOMA850101AB1',
        active: false,
      },
    ]);

    const owners = await directory.ownersOf(['GOMA850101AB1', '1']);

    expect([...owners]).toEqual([
      ['GOMA850101AB1', { employeeId: 'emp-1', companyId: 'co-1', fullName: 'Ana Rojas' }],
    ]);
  });

  it('ownersOf consulta cada PIN una sola vez', async () => {
    const { directory, findByRfcs } = setup();
    findByRfcs.mockResolvedValue([]);

    await directory.ownersOf(['A', 'B', 'A', 'A']);

    expect(findByRfcs).toHaveBeenCalledWith(['A', 'B']);
  });

  it('pinsOfCompanies delega en rfcsInCompanies con las mismas empresas', async () => {
    const { directory, rfcsInCompanies } = setup();
    rfcsInCompanies.mockResolvedValue(['GOMA850101AB1']);

    expect(await directory.pinsOfCompanies(['co-1'])).toEqual(['GOMA850101AB1']);
    expect(rfcsInCompanies).toHaveBeenCalledWith(['co-1']);
  });
});
