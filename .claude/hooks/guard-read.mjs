#!/usr/bin/env node
/** Read: no leer secretos ni seguir enlaces hacia ellos. Otras herramientas requieren permisos del host. */
import { readFileSync } from 'node:fs';
import { inspectPath } from './guard-paths.mjs';
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const reason = inspectPath(input?.tool_input?.file_path, {
    projectDir,
    cwd: input.cwd ?? projectDir,
  });
  if (reason) throw new Error(reason);
} catch (error) {
  process.stderr.write(`Lectura bloqueada: ${error.message}\n`);
  process.exitCode = 2;
}
