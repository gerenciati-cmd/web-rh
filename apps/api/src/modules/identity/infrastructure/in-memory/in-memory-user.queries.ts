import type { SessionUser } from '@rrhh/contracts';

import type { UserQueries } from '../../application/queries/user.queries';
import type { User } from '../../domain/user';

/**
 * Estructura mínima que necesita esta query: evita importar `InMemoryUserRepository`
 * (otro adaptador `/in-memory/`) para no disparar la regla `no-test-code-in-production`
 * de `arch:check`, que prohíbe que código de producción importe dobles de prueba.
 */
interface UserStore {
  readonly users: ReadonlyMap<string, User>;
}

export class InMemoryUserQueries implements UserQueries {
  constructor(private readonly deps: { userRepository: UserStore }) {}

  findSessionUser(userId: string): Promise<SessionUser | null> {
    const user = this.deps.userRepository.users.get(userId);
    return Promise.resolve(user ? { id: user.id, email: user.snapshot.email.value } : null);
  }
}
