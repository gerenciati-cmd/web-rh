import { AggregateRoot, createEvent, type Email, type Id } from '@rrhh/domain';

export type UserId = Id<'User'>;

export const USER_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface UserProps {
  email: Email;
  passwordHash: string;
  status: UserStatus;
}

export const USER_REGISTERED = 'identity.user.registered';

/**
 * Cuenta de acceso. Separada del colaborador (README decisión 2): el vínculo
 * `employeeId` llega con las invitaciones (plan 003), no aquí.
 * Sin setters ni borrado: ADR 0010 regla 1 prohíbe borrar entidades referenciables.
 */
export class User extends AggregateRoot<UserId> {
  private constructor(
    id: UserId,
    private props: UserProps,
  ) {
    super(id);
  }

  static register(input: { id: UserId; email: Email; passwordHash: string; now: Date }): User {
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      status: 'ACTIVE',
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

  get snapshot(): Readonly<UserProps> {
    return this.props;
  }
}
