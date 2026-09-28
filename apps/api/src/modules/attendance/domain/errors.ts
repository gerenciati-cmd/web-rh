import { BusinessRuleViolationError } from '@rrhh/domain';

export class DeviceNotAllowedError extends BusinessRuleViolationError {
  override readonly code = 'DEVICE_NOT_ALLOWED';

  constructor(serialNumber: string) {
    super('El dispositivo no está autorizado', { serialNumber });
  }
}
