import { ok } from '@rrhh/domain';

import type { Clock, EventBus } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import type { SessionId } from '../../domain/session';
import type { SessionRepository } from '../../domain/session.repository';

export interface LogOutInput {
  sessionId: string;
}

interface Deps {
  sessionRepository: SessionRepository;
  clock: Clock;
  eventBus: EventBus;
}

/** Idempotente: cerrar sesión sobre un id ya revocado o inexistente no es un error. */
export class LogOut implements Command<LogOutInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: LogOutInput) {
    const { sessionRepository, clock, eventBus } = this.deps;

    const session = await sessionRepository.findById(input.sessionId as SessionId);
    if (!session) return ok(undefined);

    session.revoke(clock.now());
    await sessionRepository.save(session);
    await eventBus.publish(session.pullEvents());

    return ok(undefined);
  }
}
