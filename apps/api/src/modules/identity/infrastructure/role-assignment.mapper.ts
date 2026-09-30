import type { RoleAssignment as RoleAssignmentRow } from '@/infrastructure/database/generated/client';

import { RoleAssignment, type RoleAssignmentId } from '../domain/role-assignment';
import type { UserId } from '../domain/user';

export const RoleAssignmentMapper = {
  toDomain(row: RoleAssignmentRow): RoleAssignment {
    return RoleAssignment.restore(row.id as RoleAssignmentId, {
      userId: row.userId as UserId,
      role: row.role,
      companyId: row.companyId,
      assignedAt: row.assignedAt,
      assignedBy: row.assignedBy as UserId | null,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy as UserId | null,
    });
  },

  toPersistence(assignment: RoleAssignment) {
    const s = assignment.snapshot;
    return {
      id: assignment.id,
      userId: s.userId,
      role: s.role,
      companyId: s.companyId,
      assignedAt: s.assignedAt,
      assignedBy: s.assignedBy,
      revokedAt: s.revokedAt,
      revokedBy: s.revokedBy,
    };
  },
};
