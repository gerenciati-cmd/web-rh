import type { DeviceDto, ListPunchesQuery, Page, PageQuery, PunchDto } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { AttendanceQueries } from '../application/queries/attendance.queries';

import { PunchMapper } from './attendance.mapper';

export class PrismaAttendanceQueries implements AttendanceQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listDevices({ page, pageSize }: PageQuery): Promise<Page<DeviceDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.attendanceDevice.findMany({
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceDevice.count(),
    ]);

    const lastPunches = await db.attendancePunch.groupBy({
      by: ['deviceId'],
      where: { deviceId: { in: rows.map((row) => row.id) } },
      _max: { occurredAt: true },
    });
    const lastPunchByDevice = new Map(
      lastPunches.map((group) => [group.deviceId, group._max.occurredAt]),
    );

    const items = rows.map((row) => ({
      id: row.id,
      serialNumber: row.serialNumber,
      name: row.name,
      timeZone: row.timeZone,
      active: row.active,
      registeredAt: row.registeredAt.toISOString(),
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      lastPunchAt: lastPunchByDevice.get(row.id)?.toISOString() ?? null,
    }));
    return { items, total, page, pageSize };
  }

  async listPunches({
    page,
    pageSize,
    deviceId,
    pin,
    from,
    to,
  }: ListPunchesQuery): Promise<Page<PunchDto>> {
    const db = this.deps.database.client;
    const where = {
      ...(deviceId ? { deviceId } : {}),
      ...(pin ? { pin } : {}),
      ...(from || to
        ? {
            occurredAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.attendancePunch.findMany({
        where,
        include: { device: { select: { serialNumber: true } } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendancePunch.count({ where }),
    ]);
    return {
      items: rows.map((row) => PunchMapper.toDto(row, row.device.serialNumber)),
      total,
      page,
      pageSize,
    };
  }
}
