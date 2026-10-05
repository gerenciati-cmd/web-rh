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
