import type { Role } from '@rrhh/domain';

import type { RoleAssignment, RoleAssignmentId } from '../../domain/role-assignment';
import type { RoleAssignmentRepository } from '../../domain/role-assignment.repository';
import type { UserId } from '../../domain/user';

/** Estructura mínima del almacén de usuarios (evita importar otro doble de `/in-memory/`). */
interface UserStore {
  readonly users: ReadonlyMap<string, { readonly snapshot: { readonly status: string } }>;
}

export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly deps: { userRepository: UserStore }) {}

  readonly assignments = new Map<string, RoleAssignment>();

  findById(id: RoleAssignmentId): Promise<RoleAssignment | null> {
    return Promise.resolve(this.assignments.get(id) ?? null);
  }

  findActiveByUser(userId: UserId): Promise<RoleAssignment[]> {
    return Promise.resolve(
      [...this.assignments.values()].filter((a) => a.snapshot.userId === userId && a.isActive),
    );
  }

  countActiveByRole(role: Role): Promise<number> {
    return Promise.resolve(
      [...this.assignments.values()].filter(
        (a) =>
          a.snapshot.role === role &&
          a.isActive &&
          this.deps.userRepository.users.get(a.snapshot.userId)?.snapshot.status === 'ACTIVE',
      ).length,
    );
  }

  lockUser(userId: UserId): Promise<boolean> {
    return Promise.resolve(this.deps.userRepository.users.has(userId));
  }

  save(assignment: RoleAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
    return Promise.resolve();
  }
}
