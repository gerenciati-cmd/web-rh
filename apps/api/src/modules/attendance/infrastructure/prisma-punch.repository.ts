import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { Punch } from '../domain/punch';
import type { PunchRepository } from '../domain/punch.repository';

import { PunchMapper } from './attendance.mapper';

export class PrismaPunchRepository implements PunchRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async saveNew(punches: readonly Punch[]): Promise<{ inserted: number }> {
    if (punches.length === 0) return { inserted: 0 };
    // El índice único (device_id, pin, device_local_time) descarta lo ya guardado: el equipo
    // reenvía todo su historial en cada handshake.
    const result = await this.deps.database.client.attendancePunch.createMany({
      data: punches.map((punch) => PunchMapper.toPersistence(punch)),
      skipDuplicates: true,
    });
    return { inserted: result.count };
  }

  async listInstants(pin: string, from: Date, to: Date): Promise<Date[]> {
    const rows = await this.deps.database.client.attendancePunch.findMany({
      where: { pin, occurredAt: { gte: from, lt: to } },
      select: { occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
    return rows.map((row) => row.occurredAt);
  }
}
