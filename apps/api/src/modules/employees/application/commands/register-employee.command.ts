import {
  Email,
  err,
  NationalId,
  ok,
  PersonalRfc,
  type CountryCode,
  type DomainError,
} from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { Employee, type EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import {
  EmployeeAlreadyExistsError,
  EmployeeRfcAlreadyRegisteredError,
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
  /** Obligatorio para México; la regla vive en `Employee.hire`. */
  rfc?: string | undefined;
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
    const rfc = input.rfc === undefined ? undefined : PersonalRfc.create(input.rfc);
    if (rfc && !rfc.ok) return rfc;

    const duplicate = await this.findDuplicate(input.companyId, nationalId.value, rfc?.value);
    if (duplicate) return duplicate;

    const employee = Employee.hire({
      id: idGenerator.next() as EmployeeId,
      companyId: input.companyId,
      nationalId: nationalId.value,
      firstName: input.firstName,
      lastName: input.lastName,
      email: email.value,
      rfc: rfc?.value,
      positionTitle: input.positionTitle,
      hireDate: new Date(`${input.hireDate}T00:00:00Z`),
      now: clock.now(),
    });
    if (!employee.ok) return employee;

    const saved = await employeeRepository.save(employee.value);
    if (!saved.ok) return saved;
    await eventBus.publish(employee.value.pullEvents());

    return ok({ id: employee.value.id });
  }

  /** El CURP repetido en la empresa se reporta antes que el RFC repetido en el holding. */
  private async findDuplicate(companyId: string, nationalId: NationalId, rfc?: PersonalRfc) {
    const { employeeRepository } = this.deps;
    if (await employeeRepository.existsInCompany(companyId, nationalId)) {
      return err<DomainError>(new EmployeeAlreadyExistsError(nationalId.format()));
    }
    if (rfc && (await employeeRepository.existsByRfc(rfc))) {
      return err<DomainError>(new EmployeeRfcAlreadyRegisteredError(rfc.value));
    }
    return null;
  }
}
