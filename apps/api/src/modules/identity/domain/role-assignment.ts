import { AggregateRoot, createEvent, err, ok, type Id, type Result, type Role } from '@rrhh/domain';

import { InvalidRoleScopeError, RoleNotAssignableError } from './errors';
import { ROLE_DEFINITIONS } from './role-catalog';
import type { UserId } from './user';

export type RoleAssignmentId = Id<'RoleAssignment'>;

export const ROLE_ASSIGNED = 'identity.role.assigned';
export const ROLE_REVOKED = 'identity.role.revoked';

export interface RoleAssignmentProps {
  userId: UserId;
  role: Role;
  /** `null` = todo el holding. Referencia por id a organization, sin FK (ADR 0010). */
  companyId: string | null;
  assignedAt: Date;
  /** `null` = sembrado por el sistema. */
  assignedBy: UserId | null;
  revokedAt: Date | null;
  revokedBy: UserId | null;
}

/**
 * Asignación `(usuario, rol, alcance)`. Nunca se borra: al revocar queda `revokedAt`/`revokedBy`
 * como historial (ADR 0010 regla 1).
 */
export class RoleAssignment extends AggregateRoot<RoleAssignmentId> {
  private constructor(
    id: RoleAssignmentId,
    private props: RoleAssignmentProps,
  ) {
    super(id);
  }

  static assign(input: {
    id: RoleAssignmentId;
    userId: UserId;
    role: Role;
    companyId: string | null;
    assignedBy: UserId | null;
    now: Date;
  }): Result<RoleAssignment, RoleNotAssignableError | InvalidRoleScopeError> {
    const definition = ROLE_DEFINITIONS[input.role];
    if (!definition.assignable) return err(new RoleNotAssignableError());

    const scopeIsValid =
      definition.scope === 'HOLDING' ? input.companyId === null : input.companyId !== null;
    if (!scopeIsValid) return err(new InvalidRoleScopeError());

    const assignment = new RoleAssignment(input.id, {
      userId: input.userId,
      role: input.role,
      companyId: input.companyId,
      assignedAt: input.now,
      assignedBy: input.assignedBy,
      revokedAt: null,
      revokedBy: null,
    });
    assignment.record(
      createEvent(
        ROLE_ASSIGNED,
        {
          assignmentId: input.id,
          userId: input.userId,
          role: input.role,
          companyId: input.companyId,
        },
        input.now,
      ),
    );
    return ok(assignment);
  }

  /**
   * Rol EMPLOYEE del propio colaborador, concedido solo al activar su invitación. Se salta la
   * comprobación `assignable` a propósito: ese rol no se asigna a mano sobre nadie.
   */
  static grantSelf(input: {
    id: RoleAssignmentId;
    userId: UserId;
    companyId: string;
    now: Date;
  }): RoleAssignment {
    const assignment = new RoleAssignment(input.id, {
      userId: input.userId,
      role: 'EMPLOYEE',
      companyId: input.companyId,
      assignedAt: input.now,
      assignedBy: null,
      revokedAt: null,
      revokedBy: null,
    });
    assignment.record(
      createEvent(
        ROLE_ASSIGNED,
        {
          assignmentId: input.id,
          userId: input.userId,
          role: 'EMPLOYEE',
          companyId: input.companyId,
        },
        input.now,
      ),
    );
    return assignment;
  }

  static restore(id: RoleAssignmentId, props: RoleAssignmentProps): RoleAssignment {
    return new RoleAssignment(id, props);
  }

  get isActive(): boolean {
    return this.props.revokedAt === null;
  }

  /** Idempotente: revocar una asignación ya revocada no cambia nada ni emite evento. */
  revoke(by: UserId, now: Date): void {
    if (this.props.revokedAt) return;
    this.props = { ...this.props, revokedAt: now, revokedBy: by };
    this.record(
      createEvent(
        ROLE_REVOKED,
        { assignmentId: this.id, userId: this.props.userId, role: this.props.role },
        now,
      ),
    );
  }

  get snapshot(): Readonly<RoleAssignmentProps> {
    return this.props;
  }
}
