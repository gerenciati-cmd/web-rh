import type { Role } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { RoleAssignment, RoleAssignmentId } from '../domain/role-assignment';
import type { RoleAssignmentRepository } from '../domain/role-assignment.repository';
import type { UserId } from '../domain/user';

import { RoleAssignmentMapper } from './role-assignment.mapper';

export class PrismaRoleAssignmentRepository implements RoleAssignmentRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: RoleAssignmentId): Promise<RoleAssignment | null> {
    const row = await this.deps.database.client.roleAssignment.findUnique({ where: { id } });
    return row ? RoleAssignmentMapper.toDomain(row) : null;
  }

  async findActiveByUser(userId: UserId): Promise<RoleAssignment[]> {
    const rows = await this.deps.database.client.roleAssignment.findMany({
      where: { userId, revokedAt: null },
      orderBy: { assignedAt: 'asc' },
    });
    return rows.map((row) => RoleAssignmentMapper.toDomain(row));
  }

  countActiveByRole(role: Role): Promise<number> {
    return this.deps.database.client.roleAssignment.count({
      where: { role, revokedAt: null, user: { status: 'ACTIVE' } },
    });
  }

  async lockUser(userId: UserId): Promise<boolean> {
    const rows = await this.deps.database.client.$queryRaw<{ id: string }[]>`
      SELECT id FROM identity.users WHERE id = ${userId}::uuid FOR UPDATE
    `;
    return rows.length > 0;
  }

  async save(assignment: RoleAssignment): Promise<void> {
    const data = RoleAssignmentMapper.toPersistence(assignment);
    await this.deps.database.client.roleAssignment.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }
}
