import type { TransactionRunner } from '@/shared/application/ports';

import type { PrismaDatabase } from './prisma-database';

export class PrismaTransactionRunner implements TransactionRunner {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  run<T>(work: () => Promise<T>): Promise<T> {
    return this.deps.database.inTransaction(work);
  }
}
