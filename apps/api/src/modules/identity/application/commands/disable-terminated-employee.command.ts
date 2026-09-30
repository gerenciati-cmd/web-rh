import { ok } from '@rrhh/domain';

import type { Clock, EventBus, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { InvitationRepository } from '../../domain/invitation.repository';
import type { SessionRepository } from '../../domain/session.repository';
import type { UserRepository } from '../../domain/user.repository';

export interface DisableTerminatedEmployeeInput {
  employeeId: string;
}

interface Deps {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  invitationRepository: InvitationRepository;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
}

/**
 * Reacción a `employees.employee.terminated`: deshabilita el acceso y cierra todas las sesiones
 * al instante. Idempotente (el evento puede repetirse) y sin efecto si el colaborador no tenía cuenta.
 */
export class DisableTerminatedEmployee implements Command<DisableTerminatedEmployeeInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: DisableTerminatedEmployeeInput) {
    const { userRepository, sessionRepository, invitationRepository, transactionRunner, clock } =
      this.deps;

    const user = await userRepository.findByEmployeeId(input.employeeId);
    if (!user) return ok(undefined);

    const now = clock.now();
    await transactionRunner.run(async () => {
      user.disable(now);
      await userRepository.save(user);
      await sessionRepository.revokeAllForUser(user.id, now);
      for (const pending of await invitationRepository.findPendingForEmployee(
        input.employeeId,
        now,
      )) {
        pending.supersede(now);
        await invitationRepository.save(pending);
      }
    });

    await this.deps.eventBus.publish(user.pullEvents());
    return ok(undefined);
  }
}
