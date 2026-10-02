import type { ListPunchesQuery, Page, PunchDto } from '@rrhh/contracts';

import { companiesWith, type Actor } from '@/shared/application/actor';
import type { UseCase } from '@/shared/application/use-case';

import type { AttendanceQueries } from './attendance.queries';

export type ListPunchesInput = ListPunchesQuery & { actor: Actor };

/** Solo quien tiene `attendance.punches:read` sobre todo el holding ve las marcaciones crudas. */
export class ListPunches implements UseCase<ListPunchesInput, Page<PunchDto>> {
  constructor(private readonly deps: { attendanceQueries: AttendanceQueries }) {}

  execute({ actor, ...filters }: ListPunchesInput): Promise<Page<PunchDto>> {
    // Una marcación cruda no tiene empresa hasta el plan 002 (README de attendance-marcaciones,
    // decisión 5): un permiso atado a una empresa no puede filtrar nada, así que no ve nada.
    if (companiesWith(actor, 'attendance.punches:read') !== 'ALL') {
      return Promise.resolve({
        items: [],
        total: 0,
        page: filters.page,
        pageSize: filters.pageSize,
      });
    }
    return this.deps.attendanceQueries.listPunches(filters);
  }
}
