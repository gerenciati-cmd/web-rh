import type { ListPunchesQuery, Page, PunchDto } from '@rrhh/contracts';

import { companiesWith, type Actor } from '@/shared/application/actor';
import type { UseCase } from '@/shared/application/use-case';

import type { PunchOwnerDirectory } from '../ports/punch-owner-directory';

import type { AttendanceQueries } from './attendance.queries';

export type ListPunchesInput = ListPunchesQuery & { actor: Actor };

/**
 * Holding: ve todas las marcaciones. Con permiso por empresa: solo las de colaboradores de esas
 * empresas, pues el PIN es el RFC (README de attendance-marcaciones, decisión 8). Las marcaciones
 * sin RFC coincidente quedan visibles solo para el holding.
 */
export class ListPunches implements UseCase<ListPunchesInput, Page<PunchDto>> {
  constructor(
    private readonly deps: {
      attendanceQueries: AttendanceQueries;
      punchOwnerDirectory: PunchOwnerDirectory;
    },
  ) {}

  async execute({ actor, ...filters }: ListPunchesInput): Promise<Page<PunchDto>> {
    const scope = companiesWith(actor, 'attendance.punches:read');
    let page;
    if (scope === 'ALL') {
      page = await this.deps.attendanceQueries.listPunches(filters);
    } else {
      const pins = await this.deps.punchOwnerDirectory.pinsOfCompanies(scope);
      if (pins.length === 0) {
        return { items: [], total: 0, page: filters.page, pageSize: filters.pageSize };
      }
      page = await this.deps.attendanceQueries.listPunches({ ...filters, pins });
    }

    const owners = await this.deps.punchOwnerDirectory.ownersOf(page.items.map((p) => p.pin));
    return {
      ...page,
      items: page.items.map((item) => {
        const owner = owners.get(item.pin);
        return {
          ...item,
          employee: owner
            ? { id: owner.employeeId, fullName: owner.fullName, companyId: owner.companyId }
            : null,
        };
      }),
    };
  }
}
