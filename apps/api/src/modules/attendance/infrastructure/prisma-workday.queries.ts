import type { WorkdayDto } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { WorkdayQueries } from '../application/queries/workday.queries';

import { WorkdayMapper } from './workday.mapper';

export class PrismaWorkdayQueries implements WorkdayQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listByEmployee(employeeId: string, from: string, to: string): Promise<WorkdayDto[]> {
    const rows = await this.deps.database.client.attendanceWorkday.findMany({
      where: {
        employeeId,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      include: { shift: { select: { name: true } } },
      orderBy: { date: 'asc' },
    });
    return rows.map((row) => WorkdayMapper.toDto(row));
  }
}
