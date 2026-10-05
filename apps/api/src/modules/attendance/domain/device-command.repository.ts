import type { DeviceId } from './device';
import type { DeviceCommand } from './device-command';

export interface DeviceCommandRepository {
  save(command: DeviceCommand): Promise<void>;
  /** El comando en cola más antiguo del equipo, o null si no hay. */
  nextQueued(deviceId: DeviceId): Promise<DeviceCommand | null>;
}
