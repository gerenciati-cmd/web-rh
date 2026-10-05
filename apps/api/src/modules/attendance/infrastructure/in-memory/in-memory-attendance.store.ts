import type {
  DeviceCommandDto,
  DeviceDto,
  ListPunchesQuery,
  Page,
  PageQuery,
} from '@rrhh/contracts';
import { err, ok, type Result } from '@rrhh/domain';

import type { AttendanceQueries, RawPunch } from '../../application/queries/attendance.queries';
import { Device, type DeviceId, type DeviceProps } from '../../domain/device';
import type { DeviceCommand } from '../../domain/device-command';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';
import type { DeviceRepository } from '../../domain/device.repository';
import { DeviceAlreadyRegisteredError } from '../../domain/errors';
import type { Punch } from '../../domain/punch';
import type { PunchRepository } from '../../domain/punch.repository';

/**
 * Adaptadores en memoria para tests. Cumplen los MISMOS contratos que la versión Prisma.
 * Repositorios y queries comparten el almacén para que lo escrito sea visible al leer.
 */
export class InMemoryAttendanceStore {
  readonly devices = new Map<string, Device>();
  readonly punches = new Map<string, Punch>();
  readonly commands = new Map<string, DeviceCommand>();
}

export class InMemoryDeviceCommandRepository implements DeviceCommandRepository {
  constructor(private readonly store: InMemoryAttendanceStore) {}

  save(command: DeviceCommand): Promise<void> {
    this.store.commands.set(command.id, command);
    return Promise.resolve();
  }

  nextQueued(deviceId: DeviceId): Promise<DeviceCommand | null> {
    const queued = [...this.store.commands.values()]
      .filter((command) => command.deviceId === deviceId && command.status === 'QUEUED')
      .sort(
        (a, b) =>
          a.queuedAt.getTime() - b.queuedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    return Promise.resolve(queued[0] ?? null);
  }
}

/**
 * Guarda y entrega copias, como una BD: un agregado cargado antes no ve (ni pisa) lo que otro
 * escribió después, y cada `save*` copia solo sus columnas (mismas reglas que Prisma).
 */
export class InMemoryDeviceRepository implements DeviceRepository {
  constructor(private readonly store: InMemoryAttendanceStore) {}

  findById(id: DeviceId): Promise<Device | null> {
    const device = this.store.devices.get(id);
    return Promise.resolve(device ? copyDevice(device) : null);
  }

  findBySerialNumber(serialNumber: string): Promise<Device | null> {
    const devices = [...this.store.devices.values()];
    const device = devices.find((other) => other.serialNumber === serialNumber);
    return Promise.resolve(device ? copyDevice(device) : null);
  }

  add(device: Device): Promise<Result<void, DeviceAlreadyRegisteredError>> {
    const duplicate = [...this.store.devices.values()].some(
      (other) => other.id === device.id || other.serialNumber === device.serialNumber,
    );
    if (duplicate)
      return Promise.resolve(err(new DeviceAlreadyRegisteredError(device.serialNumber)));
    this.store.devices.set(device.id, copyDevice(device));
    return Promise.resolve(ok(undefined));
  }

  saveContact(device: Device): Promise<void> {
    return this.merge(device, {
      lastSeenAt: device.lastSeenAt,
      lastSeenIp: device.lastSeenIp,
      clockOffsetSeconds: device.clockOffsetSeconds,
      clockOffsetMeasuredAt: device.clockOffsetMeasuredAt,
    });
  }

  saveSite(device: Device): Promise<void> {
    return this.merge(device, { siteId: device.siteId, timeZone: device.timeZone });
  }

  saveAllowedNetworks(device: Device): Promise<void> {
    return this.merge(device, { allowedNetworks: [...device.allowedNetworks] });
  }

  private merge(device: Device, fields: Partial<DeviceProps>): Promise<void> {
    const stored = this.store.devices.get(device.id);
    // Igual que el `update` de Prisma: actualizar un equipo inexistente es un error inesperado.
    if (!stored) return Promise.reject(new Error(`Equipo inexistente: ${device.id}`));
    this.store.devices.set(device.id, copyDevice(stored, fields));
    return Promise.resolve();
  }
}

function copyDevice(device: Device, fields: Partial<DeviceProps> = {}): Device {
  return Device.restore(device.id, {
    serialNumber: device.serialNumber,
    name: device.name,
    timeZone: device.timeZone,
    active: device.active,
    registeredAt: device.registeredAt,
    lastSeenAt: device.lastSeenAt,
    siteId: device.siteId,
    clockOffsetSeconds: device.clockOffsetSeconds,
    clockOffsetMeasuredAt: device.clockOffsetMeasuredAt,
    allowedNetworks: device.allowedNetworks,
    lastSeenIp: device.lastSeenIp,
    ...fields,
  });
}

export class InMemoryPunchRepository implements PunchRepository {
  constructor(private readonly store: InMemoryAttendanceStore) {}

  saveNew(punches: readonly Punch[]): Promise<{ inserted: number }> {
    let inserted = 0;
    for (const punch of punches) {
      const exists = [...this.store.punches.values()].some(
        (other) =>
          other.deviceId === punch.deviceId &&
          other.pin === punch.pin &&
          other.deviceLocalTime === punch.deviceLocalTime,
      );
      if (exists) continue;
      this.store.punches.set(punch.id, punch);
      inserted += 1;
    }
    return Promise.resolve({ inserted });
  }
}

export class InMemoryAttendanceQueries implements AttendanceQueries {
  constructor(private readonly store: InMemoryAttendanceStore) {}

  listDevices({ page, pageSize }: PageQuery): Promise<Page<DeviceDto>> {
    const all = [...this.store.devices.values()]
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
      .map((device) => this.toDeviceDto(device));
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  listDeviceCommands(
    deviceId: string,
    { page, pageSize }: PageQuery,
  ): Promise<Page<DeviceCommandDto>> {
    const all = [...this.store.commands.values()]
      .filter((command) => command.deviceId === deviceId)
      .sort(
        (a, b) =>
          b.queuedAt.getTime() - a.queuedAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .map((command) => ({
        id: command.id,
        command: command.command,
        status: command.status,
        queuedAt: command.queuedAt.toISOString(),
        sentAt: command.sentAt?.toISOString() ?? null,
        queuedBy: command.queuedBy,
      }));
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  listPunches({
    page,
    pageSize,
    deviceId,
    pin,
    pins,
    from,
    to,
  }: ListPunchesQuery & { pins?: readonly string[] | undefined }): Promise<Page<RawPunch>> {
    const fromTime = from ? new Date(from).getTime() : null;
    const toTime = to ? new Date(to).getTime() : null;
    const all = [...this.store.punches.values()]
      .filter(
        (punch) =>
          (!deviceId || punch.deviceId === deviceId) &&
          (!pin || punch.pin === pin) &&
          (!pins || pins.includes(punch.pin)) &&
          (fromTime === null || punch.occurredAt.getTime() >= fromTime) &&
          (toTime === null || punch.occurredAt.getTime() <= toTime),
      )
      .sort(
        (a, b) =>
          b.occurredAt.getTime() - a.occurredAt.getTime() ||
          (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      )
      .map((punch) => this.toPunchDto(punch));
    const items = all.slice((page - 1) * pageSize, page * pageSize);
    return Promise.resolve({ items, total: all.length, page, pageSize });
  }

  private toDeviceDto(device: Device): DeviceDto {
    const times = [...this.store.punches.values()]
      .filter((punch) => punch.deviceId === device.id)
      .map((punch) => punch.occurredAt.getTime());
    return {
      id: device.id,
      serialNumber: device.serialNumber,
      name: device.name,
      timeZone: device.timeZone,
      active: device.active,
      registeredAt: device.registeredAt.toISOString(),
      lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      lastPunchAt: times.length > 0 ? new Date(Math.max(...times)).toISOString() : null,
      siteId: device.siteId,
      clockOffsetSeconds: device.clockOffsetSeconds,
      clockOffsetMeasuredAt: device.clockOffsetMeasuredAt?.toISOString() ?? null,
      clockSuspect: device.clockSuspect,
      allowedNetworks: [...device.allowedNetworks],
      lastSeenIp: device.lastSeenIp,
    };
  }

  private toPunchDto(punch: Punch): RawPunch {
    return {
      id: punch.id,
      deviceId: punch.deviceId,
      serialNumber: this.store.devices.get(punch.deviceId)?.serialNumber ?? '',
      pin: punch.pin,
      occurredAt: punch.occurredAt.toISOString(),
      deviceLocalTime: punch.deviceLocalTime,
      status: punch.status,
      verifyMode: punch.verifyMode,
      receivedAt: punch.receivedAt.toISOString(),
    };
  }
}
