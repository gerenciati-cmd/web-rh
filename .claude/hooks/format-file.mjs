#!/usr/bin/env node
/**
 * PostToolUse(Edit|Write|MultiEdit): formatea con Prettier el archivo recién editado.
 * Nunca bloquea (siempre sale con 0): el formato no debe interrumpir el trabajo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FORMATTABLE = /\.(ts|tsx|js|mjs|cjs|json|md|yml|yaml|css)$/;
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const prettier = path.join(projectDir, 'node_modules', '.bin', 'prettier');

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const filePath = input?.tool_input?.file_path;
  // Solo archivos del repo: nunca reformatear memoria, scratchpad u otros proyectos.
  const rel = filePath ? path.relative(projectDir, path.resolve(projectDir, filePath)) : '..';
  const insideProject = !rel.startsWith('..') && !path.isAbsolute(rel);
  if (insideProject && FORMATTABLE.test(filePath) && existsSync(filePath) && existsSync(prettier)) {
    // --ignore-unknown + .prettierignore: respeta generados, migraciones, lockfile.
    spawnSync(prettier, ['--write', '--ignore-unknown', '--log-level', 'silent', filePath], {
      cwd: projectDir,
      stdio: 'ignore',
      timeout: 15_000,
    });
  }
} catch {
  // Silencioso a propósito.
}
process.exit(0);
