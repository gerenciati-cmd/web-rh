import type { RoleAssignmentDto } from '@rrhh/contracts';
import { err, ok, type Result } from '@rrhh/domain';

import type { UseCase } from '@/shared/application/use-case';

import { UserNotFoundError } from '../../domain/errors';

import type { UserQueries } from './user.queries';

export class ListRoleAssignments implements UseCase<
  { userId: string },
  Result<RoleAssignmentDto[], UserNotFoundError>
> {
  constructor(private readonly deps: { userQueries: UserQueries }) {}

  async execute(input: {
    userId: string;
  }): Promise<Result<RoleAssignmentDto[], UserNotFoundError>> {
    const assignments = await this.deps.userQueries.listActiveRoleAssignments(input.userId);
    return assignments ? ok(assignments) : err(new UserNotFoundError());
  }
}
