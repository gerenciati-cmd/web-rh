#!/usr/bin/env node
/**
 * `pnpm db:reset`          → borra y reconstruye la base de DESARROLLO (pide confirmación).
 * `pnpm db:reset --no-seed`→ igual, sin datos de ejemplo.
 * `pnpm db:reset --test`   → borra y reconstruye rrhh_test (sin confirmación).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';

import { resetDatabase } from './database-reset.mjs';

const USAGE = 'Uso: pnpm db:reset [--no-seed] | pnpm db:reset --test';
const ENV_FILE = 'apps/api/.env';

const flags = process.argv.slice(2);
const target = flags.includes('--test') ? 'test' : 'dev';
const seed = !flags.includes('--no-seed');

if (flags.some((flag) => !['--test', '--no-seed'].includes(flag)) || (target === 'test' && !seed)) {
  console.error(USAGE);
  process.exit(1);
}

// Como `process.loadEnvFile`: lo que ya está en el entorno gana sobre el archivo.
const fileEnv = existsSync(ENV_FILE) ? parseEnv(readFileSync(ENV_FILE, 'utf8')) : {};
const env = { ...fileEnv, ...process.env };

async function confirm(expectedName) {
  if (!process.stdin.isTTY) {
    console.error('El reset de la base de desarrollo requiere una terminal interactiva');
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(
      `Escribe el nombre de la base (${expectedName}) para borrarla: `,
    );
    return answer.trim() === expectedName;
  } finally {
    prompt.close();
  }
}

try {
  await resetDatabase(
    { target, seed },
    { run: execFileSync, confirm, env, log: (line) => console.log(line) },
  );
  console.log('\n✔ Listo.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Reset fallido');
  process.exitCode = 1;
}
