import { afterAll, beforeEach } from 'vitest';

import { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import { testDatabaseUrl } from './test-database-url';

/**
 * Base de test compartida por un archivo de tests de integración.
 * `tables`: tablas (schema.tabla) que el archivo ensucia; se vacían antes de cada test.
 */
export function useTestDatabase(tables: readonly string[]): PrismaDatabase {
  const database = new PrismaDatabase({ databaseUrl: testDatabaseUrl() });

  beforeEach(async () => {
    // Seguro: testDatabaseUrl() garantiza que la base termina en _test.
    const list = tables.map((table) => `"${table.split('.').join('"."')}"`).join(', ');
    await database.client.$executeRawUnsafe(`TRUNCATE ${list} CASCADE`);
  });

  afterAll(async () => {
    await database.disconnect();
  });

  return database;
}
