import type { Role } from '@rrhh/domain';

import type { RoleAssignment, RoleAssignmentId } from './role-assignment';
import type { UserId } from './user';

export interface RoleAssignmentRepository {
  findById(id: RoleAssignmentId): Promise<RoleAssignment | null>;
  /** Solo asignaciones sin revocar. */
  findActiveByUser(userId: UserId): Promise<RoleAssignment[]>;
  /** Solo asignaciones activas de usuarios ACTIVE: un administrador deshabilitado no cuenta (decisión 18). */
  countActiveByRole(role: Role): Promise<number>;
  /**
   * Debe llamarse dentro de `transactionRunner.run`: bloquea la fila del usuario hasta el fin de
   * la transacción y serializa las asignaciones concurrentes de ese usuario. `false` si no existe.
   */
  lockUser(userId: UserId): Promise<boolean>;
  save(assignment: RoleAssignment): Promise<void>;
}
