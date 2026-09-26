import type { HealthCheck } from '@/shared/application/ports';

import type { PrismaDatabase } from './prisma-database';

export class DatabaseHealthCheck implements HealthCheck {
  readonly name = 'database';

  constructor(private readonly deps: { database: PrismaDatabase }) {}

  check(): Promise<boolean> {
    return this.deps.database.ping();
  }
}
