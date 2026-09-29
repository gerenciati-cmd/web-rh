import type { SessionUser } from '@rrhh/contracts';

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
      select: { id: true, email: true },
    });
    return row;
  }
}
