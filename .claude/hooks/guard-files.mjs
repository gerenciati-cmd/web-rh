#!/usr/bin/env node
/** PreToolUse: valida todas las rutas de una edición; entrada incierta no autoriza escritura. */
import { readFileSync } from 'node:fs';
import { inspectPath } from './guard-paths.mjs';

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const args = input?.tool_input;
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('Payload de edición inválido');
  const parent = args.file_path ?? args.notebook_path;
  const files = [];
  if (parent !== undefined) files.push(parent);
  if (args.edits !== undefined) {
    if (!Array.isArray(args.edits) || !args.edits.length)
      throw new Error('MultiEdit vacío o inválido');
    for (const edit of args.edits) {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit))
        throw new Error('Miembro MultiEdit inválido');
      files.push(edit.file_path ?? edit.notebook_path ?? parent);
    }
  }
  if (!files.length) throw new Error('Edición sin rutas reconocidas');
  for (const file of files) {
    const reason = inspectPath(file, { projectDir, cwd: input.cwd ?? projectDir, write: true });
    if (reason) throw new Error(reason);
  }
} catch (error) {
  process.stderr.write(`Edición bloqueada: ${error.message}\n`);
  process.exitCode = 2;
}
