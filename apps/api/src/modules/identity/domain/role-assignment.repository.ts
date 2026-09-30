import type { Role } from '@rrhh/domain';

import type { RoleAssignment, RoleAssignmentId } from './role-assignment';
import type { UserId } from './user';

export interface RoleAssignmentRepository {
  findById(id: RoleAssignmentId): Promise<RoleAssignment | null>;
  /** Solo asignaciones sin revocar. */
  findActiveByUser(userId: UserId): Promise<RoleAssignment[]>;
  countActiveByRole(role: Role): Promise<number>;
  save(assignment: RoleAssignment): Promise<void>;
}
