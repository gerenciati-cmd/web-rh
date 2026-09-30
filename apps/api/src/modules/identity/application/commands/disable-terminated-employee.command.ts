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
 * al instante, y reemplaza sus invitaciones pendientes aunque aún no tuviera cuenta. Idempotente
 * (el evento puede repetirse).
 */
export class DisableTerminatedEmployee implements Command<DisableTerminatedEmployeeInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: DisableTerminatedEmployeeInput) {
    const { userRepository, sessionRepository, invitationRepository, transactionRunner, clock } =
      this.deps;

    const now = clock.now();
    const user = await transactionRunner.run(async () => {
      // Primero las invitaciones, incluso sin cuenta aún: una activación en curso que las lea
      // después falla, y una que ya confirmó deja un User que el findByEmployeeId de abajo ve.
      for (const pending of await invitationRepository.findPendingForEmployee(
        input.employeeId,
        now,
      )) {
        pending.supersede(now);
        await invitationRepository.save(pending);
      }
      const found = await userRepository.findByEmployeeId(input.employeeId);
      if (!found) return null;
      found.disable(now);
      await userRepository.save(found);
      await sessionRepository.revokeAllForUser(found.id, now);
      return found;
    });
    if (!user) return ok(undefined);

    await this.deps.eventBus.publish(user.pullEvents());
    return ok(undefined);
  }
}
