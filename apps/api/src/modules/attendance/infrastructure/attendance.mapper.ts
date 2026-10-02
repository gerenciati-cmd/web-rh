import type {
  AttendanceDevice as DeviceRow,
  AttendancePunch as PunchRow,
} from '@/infrastructure/database/generated/client';

import type { RawPunch } from '../application/queries/attendance.queries';
import { Device, type DeviceId } from '../domain/device';
import type { Punch } from '../domain/punch';

/**
 * Traductor entre filas Prisma y dominio/DTOs. Es el ÚNICO lugar donde conviven ambos tipos:
 * ninguno se filtra al otro lado.
 */
export const DeviceMapper = {
  toDomain(row: DeviceRow): Device {
    return Device.restore(row.id as DeviceId, {
      serialNumber: row.serialNumber,
      name: row.name,
      timeZone: row.timeZone,
      active: row.active,
      registeredAt: row.registeredAt,
      lastSeenAt: row.lastSeenAt,
    });
  },

  toPersistence(device: Device) {
    return {
      id: device.id,
      serialNumber: device.serialNumber,
      name: device.name,
      timeZone: device.timeZone,
      active: device.active,
      registeredAt: device.registeredAt,
      lastSeenAt: device.lastSeenAt,
    };
  },
};

export const PunchMapper = {
  toPersistence(punch: Punch) {
    return {
      id: punch.id,
      deviceId: punch.deviceId,
      pin: punch.pin,
      deviceLocalTime: punch.deviceLocalTime,
      occurredAt: punch.occurredAt,
      status: punch.status,
      verifyMode: punch.verifyMode,
      receivedAt: punch.receivedAt,
    };
  },

  toDto(row: PunchRow, serialNumber: string): RawPunch {
    return {
      id: row.id,
      deviceId: row.deviceId,
      serialNumber,
      pin: row.pin,
      occurredAt: row.occurredAt.toISOString(),
      deviceLocalTime: row.deviceLocalTime,
      status: row.status,
      verifyMode: row.verifyMode,
      receivedAt: row.receivedAt.toISOString(),
    };
  },
};
