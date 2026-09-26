import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@rrhh/domain';

export class EmployeeAlreadyExistsError extends ConflictError {
  readonly code = 'EMPLOYEE_ALREADY_EXISTS';

  constructor(nationalId: string) {
    super('El colaborador ya está registrado en esta empresa', { nationalId });
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
