#!/usr/bin/env node
/**
 * `pnpm plans:scope <plan> [--base <rama>]` — compara los archivos cambiados contra las
 * líneas `Files:` del plan (scope lock verificable). Sale con 1 si hay cambios fuera del plan.
 *
 * Cambiados = commits de la rama vs. la base + cambios sin commitear + archivos nuevos.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { ROOT, declaredFiles, parsePlan } from './lib.mjs';

/** Hot files append-only (docs/harness/HARNESS.md): permitidos aunque el plan no los liste. */
const HOT_FILES = [
  'apps/api/src/container.ts',
  'packages/contracts/src/index.ts',
  'apps/api/prisma/schema.prisma',
  'apps/api/tests/test-app.ts',
  'docs/harness/modules.json',
];

const args = process.argv.slice(2);
const planArg = args.find(
  (arg) => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--base',
);
const base = args.includes('--base') ? args[args.indexOf('--base') + 1] : 'main';

if (!planArg || !existsSync(planArg)) {
  console.error('Uso: pnpm plans:scope plans/<iniciativa>/NNN-nombre.md [--base main]');
  process.exit(2);
}

const git = (...gitArgs) => {
  try {
    return execFileSync('git', gitArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

const hasCommits = git('rev-parse', '--verify', 'HEAD').length > 0;
const onBase = git('rev-parse', '--abbrev-ref', 'HEAD')[0] === base;
const changed = new Set([
  ...(hasCommits && !onBase ? git('diff', '--name-only', `${base}...HEAD`) : []),
  ...(hasCommits ? git('diff', '--name-only', 'HEAD') : git('diff', '--name-only', '--cached')),
  ...git('ls-files', '--others', '--exclude-standard'),
]);

const plan = parsePlan(path.resolve(planArg));
const declared = declaredFiles(plan);
const touchesSchema = declared.has('apps/api/prisma/schema.prisma');
const touchesManifest = [...declared].some((file) => file.endsWith('package.json'));

const allowed = (file) =>
  declared.has(file) ||
  [...declared].some((entry) => entry.endsWith('/') && file.startsWith(entry)) ||
  file === plan.rel ||
  // Siempre permitidos: el README de la iniciativa y documentar hallazgos (nunca arreglarlos).
  file === path.join('plans', plan.initiative, 'README.md') ||
  file.startsWith('plans/hallazgos/') ||
  HOT_FILES.includes(file) ||
  (touchesSchema && file.startsWith('apps/api/prisma/migrations/')) ||
  (touchesManifest && file === 'pnpm-lock.yaml');

const outside = [...changed].filter((file) => !allowed(file)).sort();
const hot = [...changed].filter((file) => HOT_FILES.includes(file) && !declared.has(file));
const untouched = [...declared].filter((file) => !changed.has(file) && !file.endsWith('/'));

console.log(`Plan: ${plan.rel}  (${declared.size} archivos declarados, ${changed.size} cambiados)`);
if (hot.length)
  console.log(`\nHot files cambiados (revisar que sean append-only):\n  ${hot.join('\n  ')}`);
if (untouched.length)
  console.log(`\nDeclarados sin cambios (¿paso pendiente?):\n  ${untouched.join('\n  ')}`);
if (outside.length) {
  console.error(`\n✖ Fuera del alcance del plan:\n  ${outside.join('\n  ')}`);
  process.exit(1);
}
console.log('\n✔ Todos los cambios están dentro del alcance del plan.');
