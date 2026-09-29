import type { SessionUser } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { UserQueries } from './user.queries';

export class GetCurrentUser implements UseCase<{ userId: string }, SessionUser | null> {
  constructor(private readonly deps: { userQueries: UserQueries }) {}

  execute(input: { userId: string }): Promise<SessionUser | null> {
    return this.deps.userQueries.findSessionUser(input.userId);
  }
}
