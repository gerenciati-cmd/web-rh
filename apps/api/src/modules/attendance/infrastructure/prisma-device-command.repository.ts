import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { DeviceId } from '../domain/device';
import type { DeviceCommand } from '../domain/device-command';
import type { DeviceCommandRepository } from '../domain/device-command.repository';

import { DeviceCommandMapper } from './attendance.mapper';

export class PrismaDeviceCommandRepository implements DeviceCommandRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async save(command: DeviceCommand): Promise<void> {
    const data = DeviceCommandMapper.toPersistence(command);
    await this.deps.database.client.attendanceDeviceCommand.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  async nextQueued(deviceId: DeviceId): Promise<DeviceCommand | null> {
    const row = await this.deps.database.client.attendanceDeviceCommand.findFirst({
      where: { deviceId, status: 'QUEUED' },
      orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
    });
    return row ? DeviceCommandMapper.toDomain(row) : null;
  }
}
