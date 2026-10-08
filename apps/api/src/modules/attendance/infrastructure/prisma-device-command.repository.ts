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

  async claim(command: DeviceCommand): Promise<boolean> {
    // Condicional: de dos sondeos concurrentes solo uno pasa la fila de QUEUED a SENT; el
    // segundo espera el lock, ve el cambio y no actualiza nada.
    const { count } = await this.deps.database.client.attendanceDeviceCommand.updateMany({
      where: { id: command.id, status: 'QUEUED' },
      data: { status: command.status, sentAt: command.sentAt },
    });
    return count === 1;
  }

  async nextNumber(): Promise<number> {
    const rows = await this.deps.database.client.$queryRaw<{ n: number }[]>`
      SELECT nextval(pg_get_serial_sequence('attendance.device_commands', 'number'))::int AS n
    `;
    const [row] = rows;
    if (!row) throw new Error('La secuencia de números de comando no devolvió valor');
    return row.n;
  }

  async findByNumber(deviceId: DeviceId, number: number): Promise<DeviceCommand | null> {
    const row = await this.deps.database.client.attendanceDeviceCommand.findFirst({
      where: { deviceId, number },
    });
    return row ? DeviceCommandMapper.toDomain(row) : null;
  }
}
