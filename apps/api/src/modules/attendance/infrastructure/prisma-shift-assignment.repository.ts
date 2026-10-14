import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

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
}
