import type { SessionUser } from '@rrhh/contracts';
import { describe, expect, it } from 'vitest';

import { GetCurrentUser } from './get-current-user.query';
import type { UserQueries } from './user.queries';

class StubUserQueries implements UserQueries {
  constructor(private readonly users: Map<string, SessionUser>) {}

  // Fuera de lo que ejercita este test (plan 002): el puerto creció, el stub solo lo cumple.
  listUsers(): ReturnType<UserQueries['listUsers']> {
    return Promise.reject(new Error('no usado en este test'));
  }

  listActiveRoleAssignments(): ReturnType<UserQueries['listActiveRoleAssignments']> {
    return Promise.reject(new Error('no usado en este test'));
  }

  findSessionUser(userId: string): Promise<SessionUser | null> {
    return Promise.resolve(this.users.get(userId) ?? null);
  }
}

describe('GetCurrentUser', () => {
  it('delega en UserQueries.findSessionUser', async () => {
    const sessionUser: SessionUser = { id: 'user-1', email: 'ana@aps.cl' };
    const getCurrentUser = new GetCurrentUser({
      userQueries: new StubUserQueries(new Map([['user-1', sessionUser]])),
    });

    const result = await getCurrentUser.execute({ userId: 'user-1' });

    expect(result).toEqual(sessionUser);
  });

  it('resuelve null si el usuario no existe', async () => {
    const getCurrentUser = new GetCurrentUser({
      userQueries: new StubUserQueries(new Map()),
    });

    const result = await getCurrentUser.execute({ userId: 'no-existe' });

    expect(result).toBeNull();
  });
});
