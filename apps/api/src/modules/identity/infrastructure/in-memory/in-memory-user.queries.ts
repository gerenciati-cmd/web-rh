import type {
  Page,
  PageQuery,
  RoleAssignmentDto,
  SessionUser,
  UserListItem,
} from '@rrhh/contracts';

import type { UserQueries } from '../../application/queries/user.queries';
import type { RoleAssignment } from '../../domain/role-assignment';
import type { User } from '../../domain/user';

/**
 * Estructuras mínimas que necesita esta query: evita importar `InMemoryUserRepository` ni
 * `InMemoryRoleAssignmentRepository` (otros adaptadores `/in-memory/`) para no disparar la regla
 * `no-test-code-in-production` de `arch:check`, que prohíbe que código de producción importe
 * dobles de prueba.
 */
interface UserStore {
  readonly users: ReadonlyMap<string, User>;
}

interface RoleAssignmentStore {
  readonly assignments: ReadonlyMap<string, RoleAssignment>;
}

export class InMemoryUserQueries implements UserQueries {
  constructor(
    private readonly deps: {
      userRepository: UserStore;
      roleAssignmentRepository: RoleAssignmentStore;
    },
  ) {}

  findSessionUser(userId: string): Promise<SessionUser | null> {
    const user = this.deps.userRepository.users.get(userId);
    return Promise.resolve(
      user
        ? { id: user.id, email: user.snapshot.email.value, employeeId: user.snapshot.employeeId }
        : null,
    );
  }

  listUsers({
    page,
    pageSize,
    search,
  }: PageQuery & { search?: string | undefined }): Promise<Page<UserListItem>> {
    const needle = search?.toLowerCase();
    const all = [...this.deps.userRepository.users.values()]
      .map((user) => ({
        id: user.id,
        email: user.snapshot.email.value,
        status: user.snapshot.status,
      }))
      .filter((user) => !needle || user.email.toLowerCase().includes(needle))
      .sort((a, b) => (a.email < b.email ? -1 : a.email > b.email ? 1 : 0));
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  listActiveRoleAssignments(userId: string): Promise<RoleAssignmentDto[] | null> {
    if (!this.deps.userRepository.users.has(userId)) return Promise.resolve(null);
    const active = [...this.deps.roleAssignmentRepository.assignments.values()]
      .filter((a) => a.snapshot.userId === userId && a.isActive)
      .sort((a, b) => a.snapshot.assignedAt.getTime() - b.snapshot.assignedAt.getTime())
      .map((a) => ({
        id: a.id,
        role: a.snapshot.role,
        companyId: a.snapshot.companyId,
        assignedAt: a.snapshot.assignedAt.toISOString(),
      }));
    return Promise.resolve(active);
  }
}
