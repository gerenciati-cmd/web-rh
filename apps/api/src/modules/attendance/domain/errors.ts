import { BusinessRuleViolationError, ConflictError } from '@rrhh/domain';

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
