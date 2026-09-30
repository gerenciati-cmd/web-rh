import type {
  Page,
  PageQuery,
  RoleAssignmentDto,
  SessionUser,
  UserListItem,
} from '@rrhh/contracts';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { UserQueries } from '../application/queries/user.queries';

/**
 * Lado lectura: consulta optimizada con `select` de solo lo que la vista necesita.
 * No construye el agregado `User`: no hay invariantes que proteger al leer.
 */
export class PrismaUserQueries implements UserQueries {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findSessionUser(userId: string): Promise<SessionUser | null> {
    const row = await this.deps.database.client.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, employeeId: true },
    });
    return row;
  }

  async listUsers({
    page,
    pageSize,
    search,
  }: PageQuery & { search?: string | undefined }): Promise<Page<UserListItem>> {
    const db = this.deps.database.client;
    const where = search ? { email: { contains: search, mode: 'insensitive' as const } } : {};
    const [rows, total] = await Promise.all([
      db.user.findMany({
        where,
        select: { id: true, email: true, status: true },
        orderBy: { email: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.user.count({ where }),
    ]);
    return { items: rows, total, page, pageSize };
  }

  async listActiveRoleAssignments(userId: string): Promise<RoleAssignmentDto[] | null> {
    const row = await this.deps.database.client.user.findUnique({
      where: { id: userId },
      select: {
        roleAssignments: {
          where: { revokedAt: null },
          orderBy: { assignedAt: 'asc' },
          select: { id: true, role: true, companyId: true, assignedAt: true },
        },
      },
    });
    if (!row) return null;
    return row.roleAssignments.map((a) => ({ ...a, assignedAt: a.assignedAt.toISOString() }));
  }
}
