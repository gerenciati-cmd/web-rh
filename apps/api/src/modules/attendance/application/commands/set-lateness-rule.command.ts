import type { SetLatenessRuleInput as SetLatenessRuleBody } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { CompanyNotFoundError, LatenessRuleInPastError } from '../../domain/errors';
import type { LatenessRuleRepository } from '../../domain/lateness-rule.repository';
import { utcDate } from '../../domain/workday-recalculation';
import type { ShiftCompanyDirectory } from '../ports/shift-company-directory';

export interface SetLatenessRuleInput extends SetLatenessRuleBody {
  companyId: string;
  effectiveFrom: string;
  setBy: string;
}

interface Deps {
  latenessRuleRepository: LatenessRuleRepository;
  shiftCompanyDirectory: ShiftCompanyDirectory;
  clock: Clock;
}

/**
 * Define la regla de N retardos = 1 falta de una empresa desde una fecha (README de
 * attendance-asistencia-diaria, decisiones 26-30). No encola recálculo: la fecha no puede ser
 * pasada y toda jornada guardada es anterior a hoy, así que ningún día guardado cae en un
 * periodo de la regla nueva.
 */
export class SetLatenessRule implements Command<SetLatenessRuleInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: SetLatenessRuleInput) {
    if (!(await this.deps.shiftCompanyDirectory.exists(input.companyId))) {
      return err<DomainError>(new CompanyNotFoundError(input.companyId));
    }
    const now = this.deps.clock.now();
    const today = utcDate(now);
    if (input.effectiveFrom < today) {
      return err<DomainError>(new LatenessRuleInPastError(input.effectiveFrom, today));
    }
    await this.deps.latenessRuleRepository.put({
      companyId: input.companyId,
      effectiveFrom: input.effectiveFrom,
      threshold: input.threshold,
      period: input.period,
      setAt: now,
      setBy: input.setBy,
    });
    return ok(undefined);
  }
}
