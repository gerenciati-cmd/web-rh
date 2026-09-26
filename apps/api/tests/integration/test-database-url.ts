import { existsSync } from 'node:fs';

/**
 * URL de la base de TEST. Usa DATABASE_URL_TEST o, si no existe, deriva de DATABASE_URL
 * agregando `_test` al nombre de la base. Se niega a devolver una base que no termine en `_test`:
 * los tests de integración borran datos y jamás deben tocar la base de desarrollo.
 */
export function testDatabaseUrl(): string {
  if (existsSync('.env')) process.loadEnvFile('.env');

  const explicit = process.env.DATABASE_URL_TEST;
  const source = explicit ?? process.env.DATABASE_URL;
  if (!source) throw new Error('Define DATABASE_URL_TEST (o DATABASE_URL) en apps/api/.env');

  const url = new URL(source);
  if (!explicit) url.pathname = `${url.pathname}_test`;

  const databaseName = url.pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(`Base de test inválida "${databaseName}": debe terminar en _test`);
  }
  return url.toString();
}
