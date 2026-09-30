import type { Page, PageQuery, UserListItem } from '@rrhh/contracts';

import type { UseCase } from '@/shared/application/use-case';

import type { UserQueries } from './user.queries';

export type ListUsersInput = PageQuery & { search?: string | undefined };

export class ListUsers implements UseCase<ListUsersInput, Page<UserListItem>> {
  constructor(private readonly deps: { userQueries: UserQueries }) {}

  execute(input: ListUsersInput): Promise<Page<UserListItem>> {
    return this.deps.userQueries.listUsers(input);
  }
}
