import { execFileSync } from 'node:child_process';

import { testDatabaseUrl } from './test-database-url';

/** Aplica las migraciones a la base de test una vez antes de toda la suite. */
export function setup(): void {
  execFileSync('node_modules/.bin/prisma', ['migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl() },
    stdio: 'pipe',
  });
}
