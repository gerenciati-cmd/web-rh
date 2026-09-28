#!/usr/bin/env node
/** Compara un diff completo con el alcance; no poder compararlo nunca significa éxito. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ROOT, declaredFiles, parsePlan } from './lib.mjs';

const HOT_FILES = [
  'apps/api/src/container.ts',
  'packages/contracts/src/index.ts',
  'apps/api/prisma/schema.prisma',
  'apps/api/tests/test-app.ts',
  'docs/harness/modules.json',
];

/** Incluye ambos extremos de renames/copies; Git entrega nombres literales delimitados por NUL. */
function diffPaths(output) {
  const fields = output.split('\0');
  const paths = [];
  for (let i = 0; i < fields.length && fields[i];) {
    const status = fields[i++];
    const count = /^[RC]/.test(status) ? 2 : 1;
    for (let n = 0; n < count; n++) {
      const file = fields[i++];
      if (!file) throw new Error('Git devolvió un diff incompleto');
      paths.push(file);
    }
  }
  return paths;
}

/** Evalúa solo rutas. El contenido append-only de hot files lo verifica el reviewer. */
export function evaluateScope({ root, base, plan }) {
  const git = (...args) => {
    try {
      return execFileSync('git', args, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      throw new Error(
        `No se pudo calcular el alcance: falló git ${args[0]}. Verifica HEAD, base y ancestro común.`,
      );
    }
  };
  if (!base || base.startsWith('-')) throw new Error('Base inválida');
  git('rev-parse', '--verify', 'HEAD^{commit}');
  const baseCommit = git('rev-parse', '--verify', '--end-of-options', `${base}^{commit}`).trim();
  const mergeBase = git('merge-base', baseCommit, 'HEAD').trim();
  if (!mergeBase) throw new Error('La base y HEAD no tienen ancestro común');
  const diff = (...args) =>
    diffPaths(git('diff', '--name-status', '-z', '--find-renames', ...args, '--'));
  const changed = new Set([
    ...diff(mergeBase, 'HEAD'),
    ...diff('--cached', 'HEAD'),
    ...diff(),
    ...git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean),
  ]);
  const declared = declaredFiles(plan);
  const planRel = path.relative(root, plan.file).split(path.sep).join('/');
  const readme = path.posix.join(path.posix.dirname(planRel), 'README.md');
  const schema = declared.has('apps/api/prisma/schema.prisma');
  const manifest = [...declared].some((file) => file.endsWith('package.json'));
  const allowed = (file) =>
    declared.has(file) ||
    [...declared].some((entry) => entry.endsWith('/') && file.startsWith(entry)) ||
    file === planRel ||
    file === readme ||
    file.startsWith('plans/hallazgos/') ||
    HOT_FILES.includes(file) ||
    (schema && file.startsWith('apps/api/prisma/migrations/')) ||
    (manifest && file === 'pnpm-lock.yaml');
  return {
    planRel,
    declared: [...declared],
    changed: [...changed],
    outside: [...changed].filter((file) => !allowed(file)).sort(),
    hot: [...changed].filter((file) => HOT_FILES.includes(file)),
    untouched: [...declared].filter((file) => !changed.has(file) && !file.endsWith('/')),
  };
}

function main() {
  const args = process.argv.slice(2);
  let planArg;
  let base = 'main';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (!args[i].startsWith('-') && !planArg) planArg = args[i];
    else throw new Error('Uso: pnpm plans:scope <plan> [--base <base-real>]');
  }
  if (!planArg || !existsSync(planArg)) throw new Error('Indica un plan existente');
  const result = evaluateScope({ root: ROOT, base, plan: parsePlan(path.resolve(planArg)) });
  console.log(
    `Plan: ${result.planRel} (${result.declared.length} declarados, ${result.changed.length} cambiados)`,
  );
  const display = (files) => files.map((file) => JSON.stringify(file)).join('\n  ');
  if (result.hot.length)
    console.log(`Hot files: revisar contenido append-only\n  ${display(result.hot)}`);
  if (result.untouched.length)
    console.log(`Declarados sin cambios:\n  ${display(result.untouched)}`);
  if (result.outside.length) {
    console.error(`Fuera de alcance:\n  ${display(result.outside)}`);
    process.exitCode = 1;
  } else console.log('✔ Todos los cambios están dentro del alcance del plan.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
