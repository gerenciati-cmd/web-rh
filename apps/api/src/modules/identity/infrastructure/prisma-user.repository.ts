import { err, ok, type Email, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import { EmployeeAlreadyLinkedError, UserAlreadyExistsError } from '../domain/errors';
import type { User, UserId } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

import { UserMapper } from './user.mapper';

/** Distingue qué índice único falló: el driver lo reporta en `meta` (nombre de columna o índice). */
function violatesEmployeeLink(error: unknown): boolean {
  const meta = typeof error === 'object' && error !== null && 'meta' in error ? error.meta : null;
  return JSON.stringify(meta ?? {}).includes('employee_id');
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: UserId): Promise<User | null> {
    const row = await this.deps.database.client.user.findUnique({ where: { id } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.deps.database.client.user.findUnique({ where: { email: email.value } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmployeeId(employeeId: string): Promise<User | null> {
    const row = await this.deps.database.client.user.findUnique({ where: { employeeId } });
    return row ? UserMapper.toDomain(row) : null;
  }

  async save(
    user: User,
  ): Promise<Result<void, UserAlreadyExistsError | EmployeeAlreadyLinkedError>> {
    const data = UserMapper.toPersistence(user);
    try {
      await this.deps.database.client.user.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      return ok(undefined);
    } catch (error) {
      if (isUniqueViolation(error)) {
        return err(
          violatesEmployeeLink(error)
            ? new EmployeeAlreadyLinkedError()
            : new UserAlreadyExistsError(),
        );
      }
      throw error;
    }
  }
}
