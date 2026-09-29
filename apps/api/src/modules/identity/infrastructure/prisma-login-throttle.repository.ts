import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { LoginThrottle } from '../domain/login-throttle';
import type { LoginThrottleRepository } from '../domain/login-throttle.repository';

import { LoginThrottleMapper } from './login-throttle.mapper';

export class PrismaLoginThrottleRepository implements LoginThrottleRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async find(key: string): Promise<LoginThrottle | null> {
    const row = await this.deps.database.client.loginThrottle.findUnique({ where: { key } });
    return row ? LoginThrottleMapper.toDomain(row) : null;
  }

  async save(throttle: LoginThrottle): Promise<void> {
    const data = LoginThrottleMapper.toPersistence(throttle);
    await this.deps.database.client.loginThrottle.upsert({
      where: { key: data.key },
      create: data,
      update: data,
    });
  }
}
