import type { DeviceCommandDto } from '@rrhh/contracts';

import type {
  AttendanceDevice as DeviceRow,
  AttendanceDeviceCommand as DeviceCommandRow,
  AttendancePunch as PunchRow,
} from '@/infrastructure/database/generated/client';

import type { RawPunch } from '../application/queries/attendance.queries';
import { Device, type DeviceId } from '../domain/device';
import {
  DeviceCommand,
  type DeviceCommandId,
  type DeviceCommandStatus,
} from '../domain/device-command';
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
      siteId: row.siteId,
      clockOffsetSeconds: row.clockOffsetSeconds,
      clockOffsetMeasuredAt: row.clockOffsetMeasuredAt,
      allowedNetworks: row.allowedNetworks,
      lastSeenIp: row.lastSeenIp,
    });
  },

  /** Fila completa: solo para el alta (las demás escrituras son dirigidas). */
  toPersistence(device: Device) {
    return {
      id: device.id,
      serialNumber: device.serialNumber,
      name: device.name,
      timeZone: device.timeZone,
      active: device.active,
      registeredAt: device.registeredAt,
      lastSeenAt: device.lastSeenAt,
      siteId: device.siteId,
      clockOffsetSeconds: device.clockOffsetSeconds,
      clockOffsetMeasuredAt: device.clockOffsetMeasuredAt,
      allowedNetworks: [...device.allowedNetworks],
      lastSeenIp: device.lastSeenIp,
    };
  },

  /** Columnas que escribe el tráfico del equipo. */
  toContact(device: Device) {
    return {
      lastSeenAt: device.lastSeenAt,
      lastSeenIp: device.lastSeenIp,
      clockOffsetSeconds: device.clockOffsetSeconds,
      clockOffsetMeasuredAt: device.clockOffsetMeasuredAt,
    };
  },

  /** Columnas que escribe el administrador al asignar la sede. */
  toSite(device: Device) {
    return { siteId: device.siteId, timeZone: device.timeZone };
  },

  /** Columnas que escribe el administrador al definir la barrera de red. */
  toAllowedNetworks(device: Device) {
    return { allowedNetworks: [...device.allowedNetworks] };
  },
};

const DEVICE_COMMAND_STATUSES: ReadonlySet<string> = new Set<DeviceCommandStatus>([
  'QUEUED',
  'SENT',
  'DONE',
  'FAILED',
]);

// La columna es texto libre: solo existen estos valores y los escribe esta app.
function toCommandStatus(value: string): DeviceCommandStatus {
  return DEVICE_COMMAND_STATUSES.has(value) ? (value as DeviceCommandStatus) : 'QUEUED';
}

export const DeviceCommandMapper = {
  toDomain(row: DeviceCommandRow): DeviceCommand {
    return DeviceCommand.restore(row.id as DeviceCommandId, {
      deviceId: row.deviceId as DeviceId,
      number: row.number,
      command: row.command,
      status: toCommandStatus(row.status),
      queuedAt: row.queuedAt,
      sentAt: row.sentAt,
      returnCode: row.returnCode,
      completedAt: row.completedAt,
      queuedBy: row.queuedBy,
    });
  },

  toPersistence(command: DeviceCommand) {
    return {
      id: command.id,
      deviceId: command.deviceId,
      number: command.number,
      command: command.command,
      status: command.status,
      queuedAt: command.queuedAt,
      sentAt: command.sentAt,
      returnCode: command.returnCode,
      completedAt: command.completedAt,
      queuedBy: command.queuedBy,
    };
  },

  toDto(row: DeviceCommandRow): DeviceCommandDto {
    return {
      id: row.id,
      number: row.number,
      command: row.command,
      status: toCommandStatus(row.status),
      queuedAt: row.queuedAt.toISOString(),
      sentAt: row.sentAt?.toISOString() ?? null,
      returnCode: row.returnCode,
      completedAt: row.completedAt?.toISOString() ?? null,
      queuedBy: row.queuedBy,
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
