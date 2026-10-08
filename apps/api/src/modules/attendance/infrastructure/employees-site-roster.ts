import type { EmployeesApi } from '@/modules/employees';

import type { RosterMember, SiteRoster } from '../application/ports/site-roster';

/**
 * Adaptador entre módulos: implementa el puerto de attendance usando la API PÚBLICA de
 * employees (ADR 0010 regla 2).
 */
export class EmployeesSiteRoster implements SiteRoster {
  constructor(private readonly deps: { employeesApi: EmployeesApi }) {}

  async activeMembers(siteId: string): Promise<RosterMember[]> {
    const members = await this.deps.employeesApi.listActiveOnSite(siteId);
    return members.map((member) => ({
      employeeId: member.id,
      fullName: member.fullName,
      rfc: member.rfc,
    }));
  }

  async findPlacement(employeeId: string) {
    const employee = await this.deps.employeesApi.findEmployee(employeeId);
    if (!employee) return null;
    return {
      member: { employeeId: employee.id, fullName: employee.fullName, rfc: employee.rfc },
      siteId: employee.siteId,
      active: employee.active,
    };
  }
}
