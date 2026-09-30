import { err, ok, type Email, type Result } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';
import { isUniqueViolation } from '@/infrastructure/database/prisma-errors';

import { UserAlreadyExistsError } from '../domain/errors';
import type { User, UserId } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

import { UserMapper } from './user.mapper';

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

  async save(user: User): Promise<Result<void, UserAlreadyExistsError>> {
    const data = UserMapper.toPersistence(user);
    try {
      await this.deps.database.client.user.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      return ok(undefined);
    } catch (error) {
      if (isUniqueViolation(error)) return err(new UserAlreadyExistsError());
      throw error;
    }
  }
}
