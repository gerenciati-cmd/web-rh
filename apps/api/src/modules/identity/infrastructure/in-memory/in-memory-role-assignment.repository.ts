import type { Role } from '@rrhh/domain';

import type { RoleAssignment, RoleAssignmentId } from '../../domain/role-assignment';
import type { RoleAssignmentRepository } from '../../domain/role-assignment.repository';
import type { UserId } from '../../domain/user';

export class InMemoryRoleAssignmentRepository implements RoleAssignmentRepository {
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
      [...this.assignments.values()].filter((a) => a.snapshot.role === role && a.isActive).length,
    );
  }

  save(assignment: RoleAssignment): Promise<void> {
    this.assignments.set(assignment.id, assignment);
    return Promise.resolve();
  }
}
