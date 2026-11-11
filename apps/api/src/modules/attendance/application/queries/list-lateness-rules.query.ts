import type { LatenessRulesDto } from '@rrhh/contracts';
import { DEFAULT_LATENESS_RULE, err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import { CompanyNotFoundError } from '../../domain/errors';
import type { ShiftCompanyDirectory } from '../ports/shift-company-directory';

import type { LatenessRuleQueries } from './lateness-rule.queries';

/** Reglas de retardos de una empresa y la regla por defecto; una empresa inexistente es 404. */
export class ListLatenessRules implements Command<{ companyId: string }, LatenessRulesDto> {
  constructor(
    private readonly deps: {
      latenessRuleQueries: LatenessRuleQueries;
      shiftCompanyDirectory: ShiftCompanyDirectory;
    },
  ) {}

  async execute({ companyId }: { companyId: string }) {
    if (!(await this.deps.shiftCompanyDirectory.exists(companyId))) {
      return err<DomainError>(new CompanyNotFoundError(companyId));
    }
    const items = await this.deps.latenessRuleQueries.listByCompany(companyId);
    return ok({ items, default: { ...DEFAULT_LATENESS_RULE } });
  }
}
