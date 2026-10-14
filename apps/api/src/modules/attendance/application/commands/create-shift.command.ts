import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { CompanyNotFoundError } from '../../domain/errors';
import { Shift, type ShiftDay, type ShiftId } from '../../domain/shift';
import type { ShiftRepository } from '../../domain/shift.repository';
import type { ShiftCompanyDirectory } from '../ports/shift-company-directory';

export interface CreateShiftInput {
  companyId: string;
  name: string;
  cycleStartDate: string;
  toleranceMinutes: number;
  days: readonly ShiftDay[];
}

interface Deps {
  shiftRepository: ShiftRepository;
  shiftCompanyDirectory: ShiftCompanyDirectory;
  idGenerator: IdGenerator;
  clock: Clock;
}

/** Define un turno de una empresa como ciclo de días laborables y de descanso. */
export class CreateShift implements Command<CreateShiftInput, { id: ShiftId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: CreateShiftInput) {
    if (!(await this.deps.shiftCompanyDirectory.exists(input.companyId))) {
      return err<DomainError>(new CompanyNotFoundError(input.companyId));
    }

    const shift = Shift.create({
      id: this.deps.idGenerator.next() as ShiftId,
      companyId: input.companyId,
      name: input.name,
      cycleStartDate: input.cycleStartDate,
      toleranceMinutes: input.toleranceMinutes,
      days: input.days,
      now: this.deps.clock.now(),
    });
    if (!shift.ok) return shift;

    const saved = await this.deps.shiftRepository.add(shift.value);
    if (!saved.ok) return saved;

    return ok({ id: shift.value.id });
  }
}
