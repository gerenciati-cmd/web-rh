import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { Workday } from '../domain/workday';
import type { WorkdayRepository } from '../domain/workday.repository';

import { WorkdayMapper } from './workday.mapper';

export class PrismaWorkdayRepository implements WorkdayRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async replaceDates(
    employeeId: string,
    dates: readonly string[],
    workdays: readonly Workday[],
  ): Promise<void> {
    if (dates.length === 0) return;
    await this.deps.database.inTransaction(async () => {
      const db = this.deps.database.client;
      await db.attendanceWorkday.deleteMany({
        where: { employeeId, date: { in: dates.map((date) => new Date(`${date}T00:00:00Z`)) } },
      });
      if (workdays.length === 0) return;
      await db.attendanceWorkday.createMany({
        data: workdays.map((workday) => WorkdayMapper.toPersistence(workday)),
      });
    });
  }

  async listBetween(employeeId: string, from: string, to: string): Promise<Workday[]> {
    const rows = await this.deps.database.client.attendanceWorkday.findMany({
      where: {
        employeeId,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => WorkdayMapper.toDomain(row));
  }

  async lockEmployee(employeeId: string): Promise<void> {
    // Candado consultivo de transacción: se libera solo al commit/rollback. Fuera de una
    // transacción se liberaría de inmediato, así que el llamador debe abrir una. `$executeRaw`
    // en vez de `$queryRaw` porque la función devuelve `void`, que no hay que deserializar.
    await this.deps.database.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${employeeId}::text, 0))`;
  }
}
