import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { DeviceId } from '../domain/device';
import type { DeviceUser } from '../domain/device-user';
import type { DeviceUserRepository } from '../domain/device-user.repository';

import { DeviceUserMapper } from './attendance.mapper';

export class PrismaDeviceUserRepository implements DeviceUserRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listByDevice(deviceId: DeviceId): Promise<DeviceUser[]> {
    const rows = await this.deps.database.client.attendanceDeviceUser.findMany({
      where: { deviceId },
      orderBy: { pin: 'asc' },
    });
    return rows.map((row) => DeviceUserMapper.toDomain(row));
  }

  async listByEmployee(employeeId: string): Promise<DeviceUser[]> {
    const rows = await this.deps.database.client.attendanceDeviceUser.findMany({
      where: { employeeId },
      orderBy: [{ deviceId: 'asc' }, { pin: 'asc' }],
    });
    return rows.map((row) => DeviceUserMapper.toDomain(row));
  }

  async put(user: DeviceUser): Promise<void> {
    const data = DeviceUserMapper.toPersistence(user);
    await this.deps.database.client.attendanceDeviceUser.upsert({
      where: { deviceId_pin: { deviceId: user.deviceId, pin: user.pin } },
      create: data,
      update: { employeeId: data.employeeId, syncedAt: data.syncedAt },
    });
  }

  async remove(deviceId: DeviceId, pin: string): Promise<void> {
    // deleteMany: quitar una fila que ya no existe no es un error.
    await this.deps.database.client.attendanceDeviceUser.deleteMany({ where: { deviceId, pin } });
  }
}
