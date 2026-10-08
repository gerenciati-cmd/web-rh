import type { DeviceId } from './device';
import type { DeviceUser } from './device-user';

export interface DeviceUserRepository {
  listByDevice(deviceId: DeviceId): Promise<DeviceUser[]>;
  listByEmployee(employeeId: string): Promise<DeviceUser[]>;
  /** Inserta o reemplaza por `(deviceId, pin)`. */
  put(user: DeviceUser): Promise<void>;
  remove(deviceId: DeviceId, pin: string): Promise<void>;
}
