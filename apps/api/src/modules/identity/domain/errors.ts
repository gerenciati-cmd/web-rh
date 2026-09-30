import {
  AuthenticationError,
  ConflictError,
  InvalidValueError,
  TooManyRequestsError,
} from '@rrhh/domain';

/** Nunca revela si el correo existe: mismo error para correo desconocido y contraseña errónea. */
export class InvalidCredentialsError extends AuthenticationError {
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Correo o contraseña incorrectos');
  }
}

export class LoginTemporarilyBlockedError extends TooManyRequestsError {
  readonly code = 'LOGIN_TEMPORARILY_BLOCKED';

  constructor(retryAfterSeconds: number) {
    super('Demasiados intentos fallidos. Intenta de nuevo más tarde', { retryAfterSeconds });
  }
}

export class UserAlreadyExistsError extends ConflictError {
  readonly code = 'USER_ALREADY_EXISTS';

  constructor() {
    super('Ya existe un usuario con ese correo');
  }
}

export class WeakPasswordError extends InvalidValueError {
  override readonly code = 'WEAK_PASSWORD';

  constructor(minLength: number, maxLength: number) {
    super(`La contraseña debe tener entre ${minLength} y ${maxLength} caracteres`);
  }
}
