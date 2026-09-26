import { ConflictError, NotFoundError } from '@rrhh/domain';

export class CompanyNotFoundError extends NotFoundError {
  readonly code = 'COMPANY_NOT_FOUND';

  constructor(companyId: string) {
    super('La empresa no existe', { companyId });
  }
}

export class CompanyAlreadyExistsError extends ConflictError {
  readonly code = 'COMPANY_ALREADY_EXISTS';

  constructor(taxId: string) {
    super('Ya existe una empresa con ese identificador tributario', { taxId });
  }
}
