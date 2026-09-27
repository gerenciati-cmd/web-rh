#!/usr/bin/env node
/**
 * Setup de desarrollo en un comando: `pnpm bootstrap`
 * Idempotente: se puede correr las veces que sea; nunca sobrescribe .env existentes ni borra datos.
 */
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

import { ensureTestDatabase } from './bootstrap-database.mjs';

const step = (msg) => console.log(`\n▸ ${msg}`);
const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const has = (cmd) => {
  try {
    execSync(cmd, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

step('Verificando herramientas');
const [major] = process.versions.node.split('.').map(Number);
if (major < 24) throw new Error(`Se requiere Node >= 24 (tienes ${process.versions.node})`);
if (!has('pnpm --version')) throw new Error('Falta pnpm: https://pnpm.io/installation');
if (!has('docker info')) throw new Error('Docker no está disponible o el daemon no está corriendo');
console.log('  Node, pnpm y Docker OK');

step('Archivos de entorno (solo se crean si no existen)');
for (const [example, target] of [
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/web/.env.example', 'apps/web/.env.local'],
  ['apps/mobile/.env.example', 'apps/mobile/.env'],
]) {
  if (existsSync(target)) {
    console.log(`  = ${target} ya existe`);
  } else {
    copyFileSync(example, target);
    console.log(`  + ${target}`);
  }
}

step('Dependencias');
run('pnpm install');

step('Infraestructura (Postgres, Valkey, S3, Mailpit)');
run('docker compose -f infra/docker/docker-compose.yml up -d --wait postgres redis mailpit');
run('docker compose -f infra/docker/docker-compose.yml up -d storage');

step('Base de test para integración (rrhh_test)');
console.log(ensureTestDatabase() ? '  + rrhh_test creada' : '  = rrhh_test ya existe');

step('Base de datos: cliente, migraciones y datos de ejemplo');
run('pnpm db:generate');
run('pnpm --filter @rrhh/api db:deploy');
run('pnpm db:seed');
run('pnpm test:integration');

console.log(`
✔ Listo.
  pnpm dev:api     → http://localhost:3001/api/v1   (health: /health/ready)
  pnpm dev:web     → http://localhost:3000
  pnpm dev:mobile  → Expo (escanea el QR con Expo Go)
  Mailpit          → http://localhost:8025
  Consola S3       → http://localhost:9001
`);
