import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@rrhh/domain';

export class EmployeeAlreadyExistsError extends ConflictError {
  readonly code = 'EMPLOYEE_ALREADY_EXISTS';

  constructor(nationalId: string) {
    super('El colaborador ya está registrado en esta empresa', { nationalId });
  }
}

export class EmployeeNotFoundError extends NotFoundError {
  readonly code = 'EMPLOYEE_NOT_FOUND';

  constructor(employeeId: string) {
    super('El colaborador no existe', { employeeId });
  }
}

export class EmployeeRfcAlreadyRegisteredError extends ConflictError {
  readonly code = 'EMPLOYEE_RFC_ALREADY_REGISTERED';

  constructor(rfc: string) {
    super('Ya hay un colaborador registrado con ese RFC', { rfc });
  }
}

export class RfcNotApplicableError extends BusinessRuleViolationError {
  override readonly code = 'RFC_NOT_APPLICABLE';

  constructor() {
    super('El RFC solo aplica a colaboradores de México');
  }
}

export class EmployeeAlreadyTerminatedError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_ALREADY_TERMINATED';

  constructor(employeeId: string) {
    super('El colaborador ya está desvinculado', { employeeId });
  }
}

export class EmployeeInactiveError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_INACTIVE';

  constructor(employeeId: string) {
    super('El colaborador está desvinculado', { employeeId });
  }
}

export class TerminationDateInFutureError extends BusinessRuleViolationError {
  override readonly code = 'TERMINATION_DATE_IN_FUTURE';

  constructor() {
    super('La fecha de baja no puede ser posterior a hoy');
  }
}

export class TerminationBeforeHireError extends BusinessRuleViolationError {
  override readonly code = 'TERMINATION_BEFORE_HIRE';

  constructor(hireDate: string) {
    super('La fecha de baja es anterior a la contratación', { hireDate });
  }
}

export class EmployerNotFoundError extends NotFoundError {
  readonly code = 'COMPANY_NOT_FOUND';

  constructor(companyId: string) {
    super('La empresa no existe', { companyId });
  }
}

export class InactiveEmployerError extends BusinessRuleViolationError {
  override readonly code = 'COMPANY_INACTIVE';

  constructor(companyId: string) {
    super('No se puede contratar en una empresa inactiva', { companyId });
  }
}

export class SiteNotFoundError extends NotFoundError {
  readonly code = 'SITE_NOT_FOUND';

  constructor(siteId: string) {
    super('La sede no existe', { siteId });
  }
}

export class InactiveSiteError extends BusinessRuleViolationError {
  override readonly code = 'SITE_INACTIVE';

  constructor(siteId: string) {
    super('La sede está inactiva', { siteId });
  }
}

export class SiteCountryMismatchError extends BusinessRuleViolationError {
  override readonly code = 'SITE_COUNTRY_MISMATCH';

  constructor(siteId: string, siteCountry: string, companyCountry: string) {
    super('La sede no es del mismo país que la razón social', {
      siteId,
      siteCountry,
      companyCountry,
    });
  }
}
