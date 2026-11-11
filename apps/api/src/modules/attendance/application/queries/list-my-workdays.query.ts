import type { MyWorkdaysDto } from '@rrhh/contracts';
import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  AccountNotLinkedError,
  EmployeeNotFoundError,
  EmployeeWithoutSiteError,
  MonthNotAvailableError,
  SiteNotFoundError,
} from '../../domain/errors';
import { addDays, localDateOf } from '../../domain/local-date';
import type { SiteDirectory } from '../ports/site-directory';
import type { WorkdayEmployeeDirectory } from '../ports/workday-employee-directory';

import type { WorkdayQueries } from './workday.queries';

interface Input {
  employeeId: string | null;
  month: string;
}

/**
 * Jornadas guardadas del propio colaborador en el mes actual o el anterior (README de
 * attendance-asistencia-diaria, decisión 24). El colaborador sale del actor, nunca de la entrada.
 */
export class ListMyWorkdays implements Command<Input, MyWorkdaysDto> {
  constructor(
    private readonly deps: {
      workdayEmployeeDirectory: WorkdayEmployeeDirectory;
      deviceSiteDirectory: SiteDirectory;
      workdayQueries: WorkdayQueries;
      clock: Clock;
    },
  ) {}

  async execute({ employeeId, month }: Input) {
    if (employeeId === null) return err<DomainError>(new AccountNotLinkedError());
    const employee = await this.deps.workdayEmployeeDirectory.find(employeeId);
    if (!employee) return err<DomainError>(new EmployeeNotFoundError(employeeId));
    if (employee.siteId === null) {
      return err<DomainError>(new EmployeeWithoutSiteError(employee.id));
    }
    const site = await this.deps.deviceSiteDirectory.find(employee.siteId);
    if (!site) return err<DomainError>(new SiteNotFoundError(employee.siteId));

    const today = localDateOf(this.deps.clock.now(), site.timeZone);
    const current = today.slice(0, 7);
    const previous = addDays(`${current}-01`, -1).slice(0, 7);
    if (month !== current && month !== previous) {
      return err<DomainError>(new MonthNotAvailableError(month));
    }

    const from = `${month}-01`;
    const [year, monthNumber] = month.split('-').map(Number);
    const firstOfNext = new Date(Date.UTC(year ?? 0, monthNumber ?? 1, 1))
      .toISOString()
      .slice(0, 10);
    const to = addDays(firstOfNext, -1);
    return ok({
      month,
      items: await this.deps.workdayQueries.listByEmployee(employee.id, from, to),
    });
  }
}
