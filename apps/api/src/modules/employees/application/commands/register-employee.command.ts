import { Email, err, NationalId, ok, type CountryCode, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { Employee, type EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import {
  EmployeeAlreadyExistsError,
  EmployerNotFoundError,
  InactiveEmployerError,
} from '../../domain/errors';
import type { EmployerDirectory } from '../ports/employer-directory';

export interface RegisterEmployeeInput {
  companyId: string;
  nationalId: { country: CountryCode; number: string };
  firstName: string;
  lastName: string;
  email: string;
  positionTitle?: string | undefined;
  /** Fecha ISO (YYYY-MM-DD) */
  hireDate: string;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  employerDirectory: EmployerDirectory;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

export class RegisterEmployee implements Command<RegisterEmployeeInput, { id: EmployeeId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RegisterEmployeeInput) {
    const { employeeRepository, employerDirectory, idGenerator, clock, eventBus } = this.deps;

    const employer = await employerDirectory.find(input.companyId);
    if (!employer) return err<DomainError>(new EmployerNotFoundError(input.companyId));
    if (!employer.active) return err<DomainError>(new InactiveEmployerError(input.companyId));

    const nationalId = NationalId.create(input.nationalId.country, input.nationalId.number);
    if (!nationalId.ok) return nationalId;
    const email = Email.create(input.email);
    if (!email.ok) return email;

    if (await employeeRepository.existsInCompany(input.companyId, nationalId.value)) {
      return err<DomainError>(new EmployeeAlreadyExistsError(nationalId.value.format()));
    }

    const employee = Employee.hire({
      id: idGenerator.next() as EmployeeId,
      companyId: input.companyId,
      nationalId: nationalId.value,
      firstName: input.firstName,
      lastName: input.lastName,
      email: email.value,
      positionTitle: input.positionTitle,
      hireDate: new Date(`${input.hireDate}T00:00:00Z`),
      now: clock.now(),
    });
    if (!employee.ok) return employee;

    await employeeRepository.save(employee.value);
    await eventBus.publish(employee.value.pullEvents());

    return ok({ id: employee.value.id });
  }
}
