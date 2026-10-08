import { err, ok, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import type { Device, DeviceId } from '../domain/device';
import type { DeviceRepository } from '../domain/device.repository';
import { DeviceAlreadyRegisteredError } from '../domain/errors';

import { DeviceMapper } from './attendance.mapper';

export class PrismaDeviceRepository implements DeviceRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: DeviceId): Promise<Device | null> {
    const row = await this.deps.database.client.attendanceDevice.findUnique({ where: { id } });
    return row ? DeviceMapper.toDomain(row) : null;
  }

  async findBySerialNumber(serialNumber: string): Promise<Device | null> {
    const row = await this.deps.database.client.attendanceDevice.findUnique({
      where: { serialNumber },
    });
    return row ? DeviceMapper.toDomain(row) : null;
  }

  async add(device: Device): Promise<Result<void, DeviceAlreadyRegisteredError>> {
    try {
      await this.deps.database.client.attendanceDevice.create({
        data: DeviceMapper.toPersistence(device),
      });
      return ok(undefined);
    } catch (error) {
      // Carrera entre dos altas con el mismo serial: el índice único decide.
      if (isUniqueViolation(error))
        return err(new DeviceAlreadyRegisteredError(device.serialNumber));
      throw error;
    }
  }

  // Sin try/catch: el equipo se acaba de leer; si la fila no existe es inesperado y debe fallar.
  async saveContact(device: Device): Promise<void> {
    await this.deps.database.client.attendanceDevice.update({
      where: { id: device.id },
      data: DeviceMapper.toContact(device),
    });
  }

  async saveSite(device: Device): Promise<void> {
    await this.deps.database.client.attendanceDevice.update({
      where: { id: device.id },
      data: DeviceMapper.toSite(device),
    });
  }

  async saveAllowedNetworks(device: Device): Promise<void> {
    await this.deps.database.client.attendanceDevice.update({
      where: { id: device.id },
      data: DeviceMapper.toAllowedNetworks(device),
    });
  }
}
