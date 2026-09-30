import type {
  Page,
  PageQuery,
  RoleAssignmentDto,
  SessionUser,
  UserListItem,
} from '@rrhh/contracts';

/** Puerto de lectura de usuarios: `/auth/me`, listado y roles activos. */
export interface UserQueries {
  findSessionUser(userId: string): Promise<SessionUser | null>;
  listUsers(filters: PageQuery & { search?: string | undefined }): Promise<Page<UserListItem>>;
  /** `null` = el usuario no existe. */
  listActiveRoleAssignments(userId: string): Promise<RoleAssignmentDto[] | null>;
}
