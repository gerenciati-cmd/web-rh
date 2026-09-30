import type { Actor, RequestAuthenticator } from '@/shared/application/actor';
import type { Clock } from '@/shared/application/ports';

import type { RoleAssignmentRepository } from '../domain/role-assignment.repository';
import { grantsFor } from '../domain/role-catalog';
import type { SessionRepository } from '../domain/session.repository';
import type { UserRepository } from '../domain/user.repository';

import type { SessionTokens } from './ports/session-tokens';

interface Deps {
  sessionRepository: SessionRepository;
  userRepository: UserRepository;
  roleAssignmentRepository: RoleAssignmentRepository;
  sessionTokens: SessionTokens;
  clock: Clock;
}

/** Adaptador de aplicación del puerto compartido `RequestAuthenticator` (consumido por `src/http/`). */
export class SessionAuthenticator implements RequestAuthenticator {
  constructor(private readonly deps: Deps) {}

  async authenticate(token: string): Promise<Actor | null> {
    const { sessionRepository, userRepository, roleAssignmentRepository, sessionTokens, clock } =
      this.deps;
    const now = clock.now();

    const session = await sessionRepository.findByTokenHash(sessionTokens.hashOf(token));
    if (!session?.isActiveAt(now)) return null;

    const user = await userRepository.findById(session.snapshot.userId);
    if (!user?.canSignIn) return null;

    if (session.needsTouch(now)) {
      session.touch(now);
      // recordActivity, no save (H2): solo toca `lastSeenAt` y solo si sigue sin revocar, para
      // no poder deshacer un logout concurrente con el snapshot viejo de esta petición.
      await sessionRepository.recordActivity(session);
    }

    // Los permisos se resuelven en cada petición (no viajan en la sesión): revocar un rol
    // surte efecto en la siguiente llamada del usuario.
    const grants = grantsFor(
      (await roleAssignmentRepository.findActiveByUser(user.id)).map((a) => a.snapshot),
    );
    return { userId: user.id, sessionId: session.id, grants };
  }
}
