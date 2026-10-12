import { err, ok, type DomainError, type TerminationReason } from '@rrhh/domain';

import type { Clock, EventBus } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { EmployeeId } from '../../domain/employee';
import type { EmployeeRepository } from '../../domain/employee.repository';
import { EmployeeNotFoundError } from '../../domain/errors';

export interface TerminateEmployeeInput {
  companyId: string;
  employeeId: string;
  /** Fecha de baja YYYY-MM-DD. */
  terminationDate: string;
  reason: TerminationReason;
}

interface Deps {
  employeeRepository: EmployeeRepository;
  clock: Clock;
  eventBus: EventBus;
}

/**
 * Da de baja a un colaborador. No es idempotente: una segunda baja responde
 * `EMPLOYEE_ALREADY_TERMINATED`. Identity y attendance reaccionan al evento.
 */
export class TerminateEmployee implements Command<TerminateEmployeeInput, undefined> {
  constructor(private readonly deps: Deps) {}

  async execute(input: TerminateEmployeeInput) {
    const { employeeRepository, clock, eventBus } = this.deps;

    const employee = await employeeRepository.findById(input.employeeId as EmployeeId);
    // Otra empresa se trata como inexistente: no se revela que el colaborador existe.
    if (employee?.snapshot.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError(input.employeeId));
    }

    const terminated = employee.terminate(
      { date: new Date(`${input.terminationDate}T00:00:00Z`), reason: input.reason },
      clock.now(),
    );
    if (!terminated.ok) return terminated;

    const saved = await employeeRepository.saveTermination(employee);
    if (!saved.ok) return saved;
    await eventBus.publish(employee.pullEvents());

    return ok(undefined);
  }
}
