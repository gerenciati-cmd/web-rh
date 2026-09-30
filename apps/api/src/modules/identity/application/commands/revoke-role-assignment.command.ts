import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { LastHoldingAdminError, RoleAssignmentNotFoundError } from '../../domain/errors';
import type { RoleAssignmentId } from '../../domain/role-assignment';
import type { RoleAssignmentRepository } from '../../domain/role-assignment.repository';
import type { UserId } from '../../domain/user';

export interface RevokeRoleAssignmentInput {
  userId: string;
  assignmentId: string;
  revokedBy: string;
}

interface Deps {
  roleAssignmentRepository: RoleAssignmentRepository;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
}

export class RevokeRoleAssignment implements Command<RevokeRoleAssignmentInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RevokeRoleAssignmentInput) {
    const { roleAssignmentRepository, transactionRunner, clock, eventBus } = this.deps;

    // El conteo de administradores y la escritura comparten transacción. Dos administradores
    // que se revocan mutuamente en simultáneo son un riesgo residual aceptado (sin lock).
    const result = await transactionRunner.run(async () => {
      const assignment = await roleAssignmentRepository.findById(
        input.assignmentId as RoleAssignmentId,
      );
      if (assignment?.snapshot.userId !== input.userId || !assignment.isActive) {
        return err<DomainError>(new RoleAssignmentNotFoundError());
      }

      if (
        assignment.snapshot.role === 'HOLDING_ADMIN' &&
        (await roleAssignmentRepository.countActiveByRole('HOLDING_ADMIN')) <= 1
      ) {
        return err<DomainError>(new LastHoldingAdminError());
      }

      assignment.revoke(input.revokedBy as UserId, clock.now());
      await roleAssignmentRepository.save(assignment);
      return ok(assignment);
    });
    if (!result.ok) return result;

    await eventBus.publish(result.value.pullEvents());
    return ok(undefined);
  }
}
