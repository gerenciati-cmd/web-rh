import type { Result } from '@rrhh/domain';

import type { Device, DeviceId } from './device';
import type { DeviceAlreadyRegisteredError } from './errors';

export interface DeviceRepository {
  findById(id: DeviceId): Promise<Device | null>;
  findBySerialNumber(serialNumber: string): Promise<Device | null>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(device: Device): Promise<Result<void, DeviceAlreadyRegisteredError>>;
}
