import { AggregateRoot, createEvent, type Email, type Id } from '@rrhh/domain';

export type UserId = Id<'User'>;

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserProps {
  email: Email;
  passwordHash: string;
  status: UserStatus;
  /** Colaborador vinculado, por id y sin FK (ADR 0010). `null` = persona que no es colaborador. */
  employeeId: string | null;
}

export const USER_REGISTERED = 'identity.user.registered';
export const USER_DISABLED = 'identity.user.disabled';
export const USER_PASSWORD_CHANGED = 'identity.user.password-changed';

/**
 * Cuenta de acceso. Separada del colaborador (README decisión 2): el vínculo opcional
 * `employeeId` se fija al activar una invitación.
 * Sin setters ni borrado: ADR 0010 regla 1 prohíbe borrar entidades referenciables.
 */
export class User extends AggregateRoot<UserId> {
  private constructor(
    id: UserId,
    private props: UserProps,
  ) {
    super(id);
  }

  static register(input: {
    id: UserId;
    email: Email;
    passwordHash: string;
    employeeId?: string | null;
    now: Date;
  }): User {
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      status: 'ACTIVE',
      employeeId: input.employeeId ?? null,
    });
    user.record(createEvent(USER_REGISTERED, { userId: input.id }, input.now));
    return user;
  }

  static restore(id: UserId, props: UserProps): User {
    return new User(id, props);
  }

  /** Un usuario DISABLED nunca puede iniciar sesión, aunque la contraseña sea correcta. */
  get canSignIn(): boolean {
    return this.props.status === 'ACTIVE';
  }

  /** Idempotente. La baja del acceso nunca borra al usuario (ADR 0010 regla 1). */
  disable(now: Date): void {
    if (this.props.status === 'DISABLED') return;
    this.props = { ...this.props, status: 'DISABLED' };
    this.record(createEvent(USER_DISABLED, { userId: this.id }, now));
  }

  /** El evento nunca lleva el hash: solo avisa que la contraseña cambió. */
  changePassword(passwordHash: string, now: Date): void {
    this.props = { ...this.props, passwordHash };
    this.record(createEvent(USER_PASSWORD_CHANGED, { userId: this.id }, now));
  }

  get snapshot(): Readonly<UserProps> {
    return this.props;
  }
}
