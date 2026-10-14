import type { Page, PageQuery, ShiftAssignmentDto, ShiftDto } from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { ShiftQueries } from '../application/queries/shift.queries';

import { ShiftAssignmentMapper, ShiftMapper } from './shift.mapper';

export class PrismaShiftQueries implements ShiftQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async listShifts(companyId: string, { page, pageSize }: PageQuery): Promise<Page<ShiftDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.attendanceShift.findMany({
        where: { companyId },
        // `id` desempata: con nombres repetidos el orden debe ser estable entre páginas.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceShift.count({ where: { companyId } }),
    ]);
    return { items: rows.map((row) => ShiftMapper.toDto(row)), total, page, pageSize };
  }

  async listAssignments(
    employeeId: string,
    { page, pageSize }: PageQuery,
  ): Promise<Page<ShiftAssignmentDto>> {
    const db = this.deps.database.client;
    const [rows, total] = await Promise.all([
      db.attendanceShiftAssignment.findMany({
        where: { employeeId },
        include: { shift: { select: { name: true } } },
        orderBy: { effectiveFrom: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.attendanceShiftAssignment.count({ where: { employeeId } }),
    ]);
    return {
      items: rows.map((row) => ShiftAssignmentMapper.toDto(row)),
      total,
      page,
      pageSize,
    };
  }
}
