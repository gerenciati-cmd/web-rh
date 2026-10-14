import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { ShiftId } from '../domain/shift';
import type { ShiftAssignment } from '../domain/shift-assignment';
import type { ShiftAssignmentRepository } from '../domain/shift-assignment.repository';

export class PrismaShiftAssignmentRepository implements ShiftAssignmentRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async put(assignment: ShiftAssignment): Promise<void> {
    const effectiveFrom = new Date(`${assignment.effectiveFrom}T00:00:00Z`);
    await this.deps.database.client.attendanceShiftAssignment.upsert({
      where: { employeeId_effectiveFrom: { employeeId: assignment.employeeId, effectiveFrom } },
      create: {
        employeeId: assignment.employeeId,
        companyId: assignment.companyId,
        shiftId: assignment.shiftId,
        effectiveFrom,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
      },
      update: {
        shiftId: assignment.shiftId,
        assignedAt: assignment.assignedAt,
        assignedBy: assignment.assignedBy,
      },
    });
  }

  async listByEmployee(employeeId: string): Promise<ShiftAssignment[]> {
    const rows = await this.deps.database.client.attendanceShiftAssignment.findMany({
      where: { employeeId },
      orderBy: { effectiveFrom: 'asc' },
    });
    return rows.map((row) => ({
      employeeId: row.employeeId,
      companyId: row.companyId,
      shiftId: row.shiftId as ShiftId,
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
      assignedAt: row.assignedAt,
      assignedBy: row.assignedBy,
    }));
  }
}
