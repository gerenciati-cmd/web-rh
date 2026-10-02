import { err, ok, PersonalRfc, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import type { EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import { EmployeeNotFoundError, EmployeeRfcAlreadyRegisteredError } from '../../domain/errors';

export interface AssignEmployeeRfcInput {
  companyId: string;
  employeeId: string;
  rfc: string;
}

interface Deps {
  employeeRepository: EmployeeRepository;
}

/** Captura o corrige el RFC de un colaborador. Idempotente si se repite el mismo RFC. */
export class AssignEmployeeRfc implements Command<AssignEmployeeRfcInput, undefined> {
  constructor(private readonly deps: Deps) {}

  async execute(input: AssignEmployeeRfcInput) {
    const { employeeRepository } = this.deps;

    const rfc = PersonalRfc.create(input.rfc);
    if (!rfc.ok) return rfc;

    const employee = await employeeRepository.findById(input.employeeId as EmployeeId);
    // Otra empresa se trata como inexistente: no se revela que el colaborador existe.
    if (employee?.snapshot.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError(input.employeeId));
    }

    if (await employeeRepository.existsByRfc(rfc.value, employee.id)) {
      return err<DomainError>(new EmployeeRfcAlreadyRegisteredError(rfc.value.value));
    }

    const assigned = employee.assignRfc(rfc.value);
    if (!assigned.ok) return assigned;

    const saved = await employeeRepository.save(employee);
    if (!saved.ok) return saved;

    return ok(undefined);
  }
}
