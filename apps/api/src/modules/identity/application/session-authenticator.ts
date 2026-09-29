import type { Actor, RequestAuthenticator } from '@/shared/application/actor';
import type { Clock } from '@/shared/application/ports';

import type { SessionRepository } from '../domain/session.repository';
import type { UserRepository } from '../domain/user.repository';

import type { SessionTokens } from './ports/session-tokens';

interface Deps {
  sessionRepository: SessionRepository;
  userRepository: UserRepository;
  sessionTokens: SessionTokens;
  clock: Clock;
}

/** Adaptador de aplicación del puerto compartido `RequestAuthenticator` (consumido por `src/http/`). */
export class SessionAuthenticator implements RequestAuthenticator {
  constructor(private readonly deps: Deps) {}

  async authenticate(token: string): Promise<Actor | null> {
    const { sessionRepository, userRepository, sessionTokens, clock } = this.deps;
    const now = clock.now();

    const session = await sessionRepository.findByTokenHash(sessionTokens.hashOf(token));
    if (!session?.isActiveAt(now)) return null;

    const user = await userRepository.findById(session.snapshot.userId);
    if (!user?.canSignIn) return null;

    if (session.needsTouch(now)) {
      session.touch(now);
      await sessionRepository.save(session);
    }

    return { userId: user.id, sessionId: session.id };
  }
}
