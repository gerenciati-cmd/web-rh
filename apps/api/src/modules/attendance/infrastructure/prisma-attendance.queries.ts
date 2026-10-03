import type {
  DeviceCommandDto,
  DeviceDto,
  ListPunchesQuery,
  Page,
  PageQuery,
} from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { AttendanceQueries, RawPunch } from '../application/queries/attendance.queries';
import { CLOCK_OFFSET_TOLERANCE_SECONDS } from '../domain/device';

import { DeviceCommandMapper, PunchMapper } from './attendance.mapper';

export class PrismaAttendanceQueries implements AttendanceQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listDevices({ page, pageSize }: PageQuery): Promise<Page<DeviceDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.attendanceDevice.findMany({
        // `id` desempata: con nombres repetidos el orden debe ser estable entre páginas.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
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
      siteId: row.siteId,
      clockOffsetSeconds: row.clockOffsetSeconds,
      clockOffsetMeasuredAt: row.clockOffsetMeasuredAt?.toISOString() ?? null,
      clockSuspect:
        row.clockOffsetSeconds !== null &&
        Math.abs(row.clockOffsetSeconds) > CLOCK_OFFSET_TOLERANCE_SECONDS,
    }));
    return { items, total, page, pageSize };
  }

  async listDeviceCommands(
    deviceId: string,
    { page, pageSize }: PageQuery,
  ): Promise<Page<DeviceCommandDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.attendanceDeviceCommand.findMany({
        where: { deviceId },
        orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceDeviceCommand.count({ where: { deviceId } }),
    ]);
    return { items: rows.map((row) => DeviceCommandMapper.toDto(row)), total, page, pageSize };
  }

  async listPunches({
    page,
    pageSize,
    deviceId,
    pin,
    pins,
    from,
    to,
  }: ListPunchesQuery & { pins?: readonly string[] | undefined }): Promise<Page<RawPunch>> {
    const db = this.deps.database.client;
    const where = {
      ...(deviceId ? { deviceId } : {}),
      // `pin` y `pins` comparten campo: `equals` + `in` se combinan con AND.
      ...(pin || pins
        ? { pin: { ...(pin ? { equals: pin } : {}), ...(pins ? { in: [...pins] } : {}) } }
        : {}),
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
