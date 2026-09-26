import { AsyncLocalStorage } from 'node:async_hooks';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient, type Prisma } from './generated/client';

export type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Punto único de acceso a Prisma. Los repositorios piden `database.client` y reciben
 * la transacción activa si existe (vía AsyncLocalStorage) o el cliente normal si no.
 *
 * Ningún archivo fuera de `infrastructure/` importa Prisma (lo verifica dependency-cruiser).
 */
export class PrismaDatabase {
  readonly #root: PrismaClient;
  readonly #transaction = new AsyncLocalStorage<Prisma.TransactionClient>();

  constructor(deps: { databaseUrl: string }) {
    this.#root = new PrismaClient({
      adapter: new PrismaPg({ connectionString: deps.databaseUrl }),
    });
  }

  get client(): DbClient {
    return this.#transaction.getStore() ?? this.#root;
  }

  /** Transacciones anidadas se unen a la externa en vez de abrir otra. */
  async inTransaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.#transaction.getStore()) return work();
    return this.#root.$transaction((tx) => this.#transaction.run(tx, work));
  }

  async ping(): Promise<boolean> {
    try {
      await this.#root.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.#root.$disconnect();
  }
}
