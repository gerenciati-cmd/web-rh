import { err, ok, type CountryCode, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import {
  EmployeeNotFoundError,
  EmployerNotFoundError,
  InactiveSiteError,
  SiteCountryMismatchError,
  SiteNotFoundError,
} from '../../domain/errors';
import type { EmployerDirectory } from '../ports/employer-directory';
import type { SiteDirectory } from '../ports/site-directory';

export interface AssignEmployeeSiteInput {
  companyId: string;
  employeeId: string;
  siteId: string;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  employerDirectory: EmployerDirectory;
  siteDirectory: SiteDirectory;
  clock: Clock;
  eventBus: EventBus;
}

/** Asigna o cambia la sede de un colaborador. Idempotente si se repite la misma sede. */
export class AssignEmployeeSite implements Command<AssignEmployeeSiteInput, undefined> {
  constructor(private readonly deps: Deps) {}

  async execute(input: AssignEmployeeSiteInput) {
    const { employeeRepository, employerDirectory, clock, eventBus } = this.deps;

    const employee = await employeeRepository.findById(input.employeeId as EmployeeId);
    // Otra empresa se trata como inexistente: no se revela que el colaborador existe.
    if (employee?.snapshot.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError(input.employeeId));
    }

    const employer = await employerDirectory.find(employee.snapshot.companyId);
    if (!employer) return err<DomainError>(new EmployerNotFoundError(employee.snapshot.companyId));

    const siteError = await this.checkSite(input.siteId, employer.country);
    if (siteError) return err<DomainError>(siteError);

    employee.assignSite(input.siteId, clock.now());

    const saved = await employeeRepository.save(employee);
    if (!saved.ok) return saved;
    await eventBus.publish(employee.pullEvents());

    return ok(undefined);
  }

  /** La sede debe existir, estar activa y ser del mismo país que la razón social. */
  private async checkSite(siteId: string, companyCountry: CountryCode) {
    const site = await this.deps.siteDirectory.find(siteId);
    if (!site) return new SiteNotFoundError(siteId);
    if (!site.active) return new InactiveSiteError(siteId);
    if (site.country !== companyCountry) {
      return new SiteCountryMismatchError(siteId, site.country, companyCountry);
    }
    return null;
  }
}
