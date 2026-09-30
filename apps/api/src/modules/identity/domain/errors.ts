import {
  AuthenticationError,
  BusinessRuleViolationError,
  ConflictError,
  InvalidValueError,
  NotFoundError,
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

export class RoleNotAssignableError extends BusinessRuleViolationError {
  override readonly code = 'ROLE_NOT_ASSIGNABLE';

  constructor() {
    super('Ese rol todavía no se puede asignar');
  }
}

export class InvalidRoleScopeError extends InvalidValueError {
  override readonly code = 'INVALID_ROLE_SCOPE';

  constructor() {
    super('HOLDING_ADMIN no lleva empresa; HR requiere una empresa');
  }
}

export class RoleAlreadyAssignedError extends ConflictError {
  readonly code = 'ROLE_ALREADY_ASSIGNED';

  constructor() {
    super('El usuario ya tiene ese rol activo');
  }
}

export class RoleAssignmentNotFoundError extends NotFoundError {
  readonly code = 'ROLE_ASSIGNMENT_NOT_FOUND';

  constructor() {
    super('La asignación de rol no existe');
  }
}

export class UserNotFoundError extends NotFoundError {
  readonly code = 'USER_NOT_FOUND';

  constructor() {
    super('El usuario no existe');
  }
}

export class LastHoldingAdminError extends BusinessRuleViolationError {
  override readonly code = 'LAST_HOLDING_ADMIN';

  constructor() {
    super('No se puede quitar el último administrador del holding');
  }
}

/** Mismo código que `employees` (COMPANY_NOT_FOUND): el cliente ve un solo vocabulario. */
export class AssignmentCompanyNotFoundError extends NotFoundError {
  readonly code = 'COMPANY_NOT_FOUND';

  constructor(companyId: string) {
    super('La empresa no existe', { companyId });
  }
}

export class AssignmentCompanyInactiveError extends BusinessRuleViolationError {
  override readonly code = 'COMPANY_INACTIVE';

  constructor(companyId: string) {
    super('No se puede asignar un rol en una empresa inactiva', { companyId });
  }
}

/** Mismo cuerpo para token desconocido, expirado, usado o reemplazado: no se puede sondear tokens. */
export class InvitationNotValidError extends BusinessRuleViolationError {
  override readonly code = 'INVITATION_NOT_VALID';

  constructor() {
    super('La invitación no es válida o ya expiró');
  }
}

/** Mismo cuerpo para token desconocido, expirado, usado, reemplazado o de usuario deshabilitado. */
export class PasswordResetNotValidError extends BusinessRuleViolationError {
  override readonly code = 'PASSWORD_RESET_NOT_VALID';

  constructor() {
    super('El enlace para restablecer la contraseña no es válido o ya expiró');
  }
}

export class UserDisabledError extends BusinessRuleViolationError {
  override readonly code = 'USER_DISABLED';

  constructor() {
    super('El usuario está deshabilitado');
  }
}

/** También cuando el colaborador es de otra empresa: responde igual que uno inexistente. */
export class EmployeeNotFoundError extends NotFoundError {
  readonly code = 'EMPLOYEE_NOT_FOUND';

  constructor() {
    super('El colaborador no existe');
  }
}

export class EmployeeInactiveError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_INACTIVE';

  constructor() {
    super('No se puede invitar a un colaborador desvinculado');
  }
}

export class EmployeeAlreadyLinkedError extends ConflictError {
  readonly code = 'EMPLOYEE_ALREADY_HAS_ACCESS';

  constructor() {
    super('El colaborador ya tiene acceso');
  }
}

export class EmailAlreadyRegisteredError extends ConflictError {
  readonly code = 'EMAIL_ALREADY_REGISTERED';

  constructor() {
    super('Ya existe un usuario con ese correo');
  }
}
