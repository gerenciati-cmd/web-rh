import { BusinessRuleViolationError, ConflictError, NotFoundError } from '@rrhh/domain';

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

export class DeviceNotFoundError extends NotFoundError {
  readonly code = 'DEVICE_NOT_FOUND';

  constructor(deviceId: string) {
    super('El checador no existe', { deviceId });
  }
}

export class DeviceAlreadyRegisteredError extends ConflictError {
  override readonly code = 'DEVICE_ALREADY_REGISTERED';

  constructor(serialNumber: string) {
    super('Ya existe un equipo con ese número de serie', { serialNumber });
  }
}

export class DeviceNotAllowedError extends BusinessRuleViolationError {
  override readonly code = 'DEVICE_NOT_ALLOWED';

  constructor(serialNumber: string) {
    super('El dispositivo no está autorizado', { serialNumber });
  }
}

export class DeviceNetworkUnrestrictedError extends BusinessRuleViolationError {
  override readonly code = 'DEVICE_NETWORK_UNRESTRICTED';

  constructor(deviceId: string) {
    super('El checador no tiene redes permitidas: no puede recibir comandos', { deviceId });
  }
}

export class ShiftNotFoundError extends NotFoundError {
  readonly code = 'SHIFT_NOT_FOUND';

  constructor(shiftId: string) {
    super('El turno no existe', { shiftId });
  }
}

export class ShiftAlreadyExistsError extends ConflictError {
  override readonly code = 'SHIFT_ALREADY_EXISTS';

  constructor(name: string) {
    super('Ya existe un turno con ese nombre en la empresa', { name });
  }
}

export class CompanyNotFoundError extends NotFoundError {
  readonly code = 'COMPANY_NOT_FOUND';

  constructor(companyId: string) {
    super('La empresa no existe', { companyId });
  }
}

export class EmployeeNotFoundError extends NotFoundError {
  readonly code = 'EMPLOYEE_NOT_FOUND';

  constructor(employeeId: string) {
    super('El colaborador no existe', { employeeId });
  }
}

export class EmployeeInactiveError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_INACTIVE';

  constructor(employeeId: string) {
    super('El colaborador está desvinculado', { employeeId });
  }
}

export class EmployeeWithoutRfcError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_WITHOUT_RFC';

  constructor(employeeId: string) {
    super('El colaborador no tiene RFC: sus marcaciones no se pueden atribuir', { employeeId });
  }
}

export class EmployeeWithoutSiteError extends BusinessRuleViolationError {
  override readonly code = 'EMPLOYEE_WITHOUT_SITE';

  constructor(employeeId: string) {
    super('El colaborador no tiene sede asignada', { employeeId });
  }
}

export class DeviceWithoutSiteError extends BusinessRuleViolationError {
  override readonly code = 'DEVICE_WITHOUT_SITE';

  constructor(deviceId: string) {
    super('El checador no tiene sede asignada', { deviceId });
  }
}
