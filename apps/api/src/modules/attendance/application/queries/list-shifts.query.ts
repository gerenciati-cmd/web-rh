import type { Page, PageQuery, ShiftDto } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { ShiftQueries } from './shift.queries';

/** Turnos de una empresa; el alcance por empresa lo impone la ruta. */
export class ListShifts implements UseCase<PageQuery & { companyId: string }, Page<ShiftDto>> {
  constructor(private readonly deps: { shiftQueries: ShiftQueries }) {}

  execute({ companyId, ...page }: PageQuery & { companyId: string }) {
    return this.deps.shiftQueries.listShifts(companyId, page);
  }
}
