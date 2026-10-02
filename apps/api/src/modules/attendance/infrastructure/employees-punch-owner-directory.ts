import type { EmployeesApi } from '@/modules/employees';

import type { PunchOwner, PunchOwnerDirectory } from '../application/ports/punch-owner-directory';

/**
 * Adaptador entre módulos: implementa el puerto de attendance usando la API PÚBLICA de
 * employees (ADR 0010 regla 2).
 */
export class EmployeesPunchOwnerDirectory implements PunchOwnerDirectory {
  constructor(private readonly deps: { employeesApi: EmployeesApi }) {}

  async ownersOf(pins: readonly string[]): Promise<ReadonlyMap<string, PunchOwner>> {
    const owners = await this.deps.employeesApi.findByRfcs([...new Set(pins)]);
    return new Map(
      owners.map((owner) => [
        owner.rfc,
        { employeeId: owner.id, companyId: owner.companyId, fullName: owner.fullName },
      ]),
    );
  }

  pinsOfCompanies(companyIds: readonly string[]): Promise<string[]> {
    return this.deps.employeesApi.rfcsInCompanies(companyIds);
  }
}
