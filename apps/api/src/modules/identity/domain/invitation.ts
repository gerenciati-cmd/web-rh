import {
  AggregateRoot,
  createEvent,
  err,
  ok,
  type Email,
  type Id,
  type Result,
} from '@rrhh/domain';

import { InvitationNotValidError } from './errors';
import type { UserId } from './user';

export type InvitationId = Id<'Invitation'>;

export const INVITATION_ISSUED = 'identity.invitation.issued';
export const INVITATION_ACCEPTED = 'identity.invitation.accepted';

export interface InvitationProps {
  email: Email;
  /** `null` = invitación a alguien que no es colaborador. Referencia por id, sin FK (ADR 0010). */
  employeeId: string | null;
  companyId: string | null;
  /** Solo el hash del token: el token en claro viaja únicamente en el correo (ADR 0011). */
  tokenHash: string;
  invitedBy: UserId;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Invitación a activar una cuenta. Existe aparte de `User` para que jamás haya un usuario sin
 * contraseña: el `User` nace al activar. Nunca se borra; al usarse o reemplazarse queda marcada.
 */
export class Invitation extends AggregateRoot<InvitationId> {
  private constructor(
    id: InvitationId,
    private props: InvitationProps,
  ) {
    super(id);
  }

  static issue(input: {
    id: InvitationId;
    email: Email;
    employeeId: string | null;
    companyId: string | null;
    tokenHash: string;
    invitedBy: UserId;
    ttlMs: number;
    now: Date;
  }): Invitation {
    const invitation = new Invitation(input.id, {
      email: input.email,
      employeeId: input.employeeId,
      companyId: input.companyId,
      tokenHash: input.tokenHash,
      invitedBy: input.invitedBy,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + input.ttlMs),
      acceptedAt: null,
      revokedAt: null,
    });
    invitation.record(
      createEvent(
        INVITATION_ISSUED,
        {
          invitationId: input.id,
          employeeId: input.employeeId,
          companyId: input.companyId,
          invitedBy: input.invitedBy,
        },
        input.now,
      ),
    );
    return invitation;
  }

  static restore(id: InvitationId, props: InvitationProps): Invitation {
    return new Invitation(id, props);
  }

  isPendingAt(now: Date): boolean {
    return !this.props.acceptedAt && !this.props.revokedAt && now < this.props.expiresAt;
  }

  accept(now: Date): Result<void, InvitationNotValidError> {
    if (!this.isPendingAt(now)) return err(new InvitationNotValidError());
    this.props = { ...this.props, acceptedAt: now };
    this.record(
      createEvent(
        INVITATION_ACCEPTED,
        { invitationId: this.id, employeeId: this.props.employeeId },
        now,
      ),
    );
    return ok(undefined);
  }

  /** Reemplazada por una invitación nueva o por la baja del colaborador. No-op si ya no está pendiente. */
  supersede(now: Date): void {
    if (!this.isPendingAt(now)) return;
    this.props = { ...this.props, revokedAt: now };
  }

  get snapshot(): Readonly<InvitationProps> {
    return this.props;
  }
}
