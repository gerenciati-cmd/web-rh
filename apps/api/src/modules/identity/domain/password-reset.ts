import { AggregateRoot, createEvent, err, ok, type Id, type Result } from '@rrhh/domain';

import { PasswordResetNotValidError } from './errors';
import type { UserId } from './user';

export type PasswordResetId = Id<'PasswordReset'>;

export const PASSWORD_RESET_REQUESTED = 'identity.password-reset.requested';
export const PASSWORD_RESET_COMPLETED = 'identity.password-reset.completed';

export interface PasswordResetProps {
  userId: UserId;
  /** Solo el hash del token: el token en claro viaja únicamente en el correo (ADR 0011). */
  tokenHash: string;
  /** `null` = lo pidió el propio usuario; un id = lo forzó el personal de RRHH o el holding. */
  requestedBy: UserId | null;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Solicitud de restablecer la contraseña de un usuario existente. Existe aparte de `Invitation`
 * porque pertenece a un `User` ya creado. Nunca se borra; al usarse o reemplazarse queda marcada.
 */
export class PasswordReset extends AggregateRoot<PasswordResetId> {
  private constructor(
    id: PasswordResetId,
    private props: PasswordResetProps,
  ) {
    super(id);
  }

  static issue(input: {
    id: PasswordResetId;
    userId: UserId;
    tokenHash: string;
    requestedBy: UserId | null;
    ttlMs: number;
    now: Date;
  }): PasswordReset {
    const reset = new PasswordReset(input.id, {
      userId: input.userId,
      tokenHash: input.tokenHash,
      requestedBy: input.requestedBy,
      createdAt: input.now,
      expiresAt: new Date(input.now.getTime() + input.ttlMs),
      usedAt: null,
      revokedAt: null,
    });
    reset.record(
      createEvent(
        PASSWORD_RESET_REQUESTED,
        { passwordResetId: input.id, userId: input.userId, requestedBy: input.requestedBy },
        input.now,
      ),
    );
    return reset;
  }

  static restore(id: PasswordResetId, props: PasswordResetProps): PasswordReset {
    return new PasswordReset(id, props);
  }

  isPendingAt(now: Date): boolean {
    return !this.props.usedAt && !this.props.revokedAt && now < this.props.expiresAt;
  }

  use(now: Date): Result<void, PasswordResetNotValidError> {
    if (!this.isPendingAt(now)) return err(new PasswordResetNotValidError());
    this.props = { ...this.props, usedAt: now };
    this.record(
      createEvent(
        PASSWORD_RESET_COMPLETED,
        { passwordResetId: this.id, userId: this.props.userId },
        now,
      ),
    );
    return ok(undefined);
  }

  /** Reemplazado por uno nuevo o por un restablecimiento ya completado. No-op si no está pendiente. */
  supersede(now: Date): void {
    if (!this.isPendingAt(now)) return;
    this.props = { ...this.props, revokedAt: now };
  }

  get snapshot(): Readonly<PasswordResetProps> {
    return this.props;
  }
}
