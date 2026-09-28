#!/usr/bin/env node
/** Guarda conservadora de sintaxis conocida. No es un sandbox de programas arbitrarios. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { inspectPath } from './guard-paths.mjs';

const SHELLS = new Set(['sh', 'bash', 'zsh', 'fish', 'dash']);
const DISPOSABLE = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.expo',
  'coverage',
  'generated',
  'web-build',
  'out',
]);

/** Conserva argumentos literales; no expande variables ni ejecuta sustituciones. */
export function lex(command) {
  const tokens = [];
  let value = '';
  let active = false;
  let glob = false;
  let quote = null;
  const flush = () => {
    if (active) tokens.push({ kind: 'word', value, glob });
    value = '';
    active = false;
    glob = false;
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else value += ch;
      continue;
    }
    if (ch === '$' || ch === '`')
      throw new Error('Expansión dinámica no soportada; usa argumentos literales');
    if (ch === '\\') {
      if (i + 1 >= command.length) throw new Error('Escape incompleto');
      const next = command[++i];
      if (next !== '\n') {
        value += next;
        active = true;
      }
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else value += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      active = true;
      continue;
    }
    if (ch === '#' && !active) {
      while (i + 1 < command.length && command[i + 1] !== '\n') i++;
      continue;
    }
    if (ch === '(' || ch === ')' || ch === '{' || ch === '}')
      throw new Error('Agrupación dinámica no soportada; usa comandos explícitos');
    if (/\s/.test(ch) && ch !== '\n') {
      flush();
      continue;
    }
    if (';|&<>\n'.includes(ch)) {
      flush();
      let op = ch;
      if (command[i + 1] === ch && '|&<>'.includes(ch)) op += command[++i];
      if (op === '<<' || op === '&')
        throw new Error(
          'Heredoc/background no soportado; usa un archivo revisado y un comando explícito',
        );
      tokens.push({ kind: 'op', value: op });
      continue;
    }
    active = true;
    if ('*?['.includes(ch)) glob = true;
    value += ch;
  }
  if (quote) throw new Error('Comillas sin cerrar');
  flush();
  return tokens;
}

function deny(reason) {
  throw new Error(reason);
}

/** Inspecciona únicamente formas soportadas; no abre transcripciones ni archivos de secretos. */
export function checkCommand(command, { projectDir, cwd = projectDir }, depth = 0) {
  if (depth > 8) deny('Demasiados shells anidados');
  if (typeof command !== 'string' || !command.trim()) deny('Comando vacío o inválido');
  const tokens = lex(command);
  let segment = [];
  let currentDir = cwd;
  let previousProgram = null;
  let pipe = false;
  const run = () => {
    if (!segment.length) return;
    let program = path.basename(segment[0].value);
    let args = segment.slice(1);
    if (program.includes('=') || ['env', 'eval', 'exec', 'command', 'xargs'].includes(program))
      deny('Wrapper dinámico no soportado; invoca el comando directamente');
    if (segment[0].glob) deny('Ejecutable dinámico no soportado');
    if (program === 'sudo') deny('No se usa sudo desde el agente');
    if (pipe && SHELLS.has(program) && ['curl', 'wget'].includes(previousProgram))
      deny('No ejecutar descargas mediante shell');
    if (SHELLS.has(program)) {
      const index = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg.value));
      if (index < 0 || !args[index + 1] || index + 2 !== args.length)
        deny('Shell no inspeccionable; usa comandos explícitos');
      checkCommand(args[index + 1].value, { projectDir, cwd: currentDir }, depth + 1);
    }
    if (
      /^(node|python[\d.]*|perl|ruby|php)$/.test(program) &&
      args.some(
        (arg) =>
          /^(-[ecp]|--eval(?:=|$)|--print(?:=|$)|--execute(?:=|$)|--run(?:=|$))/.test(arg.value) ||
          arg.value === '-',
      )
    )
      deny('Código inline no inspeccionable; usa un archivo revisado con permisos mínimos');
    if (program === 'cd') {
      if (args.length !== 1 || args[0].glob || args[0].value.startsWith('~'))
        deny('cd debe usar una ruta literal explícita');
      const next = path.resolve(currentDir, args[0].value);
      if (!existsSync(next)) deny('No se puede verificar el directorio de trabajo');
      currentDir = realpathSync(next);
    }
    if (program === 'rm') {
      const flags = args
        .filter((arg) => arg.value.startsWith('-'))
        .map((arg) => arg.value)
        .join(' ');
      const targets = args.filter((arg) => !arg.value.startsWith('-'));
      if (!targets.length) deny('rm sin rutas verificables');
      for (const target of targets) {
        if (target.glob || target.value.startsWith('~'))
          deny('rm requiere rutas literales sin comodines');
        const abs = path.resolve(currentDir, target.value);
        const reason = inspectPath(abs, { projectDir, write: true });
        if (reason) deny(reason);
        if (/--recursive|-[a-zA-Z]*[rR]/.test(flags)) {
          if (!DISPOSABLE.has(path.basename(abs)) || target.value.split('/').includes('..'))
            deny('Borrado recursivo fuera de carpetas desechables');
          if (existsSync(abs) && realpathSync(abs) !== abs)
            deny('No borrar recursivamente a través de enlaces');
        } else if (existsSync(abs)) {
          const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', abs], {
            cwd: projectDir,
            stdio: 'ignore',
          });
          if (tracked.status !== 0) deny('Untracked sin procedencia fiable: no borrar');
        }
      }
    }
    if (
      program === 'find' &&
      args.some((arg) => ['-delete', '-exec', '-execdir', '-ok', '-okdir'].includes(arg.value))
    )
      deny('find no puede ejecutar ni borrar desde la guarda');
    if (program === 'git') {
      while (args[0]?.value.startsWith('-')) {
        if (args[0].value === '-C' && args[1]) {
          args = args.slice(2);
          continue;
        }
        if (['--no-pager', '--literal-pathspecs'].includes(args[0].value)) {
          args = args.slice(1);
          continue;
        }
        deny('Opción global de Git no soportada');
      }
      const sub = args[0]?.value;
      const vals = args.slice(1).map((a) => a.value);
      if (sub === 'stash' && !['list', 'show'].includes(vals[0]))
        deny('git stash cambia trabajo compartido');
      if (sub === 'reset' && vals.includes('--hard')) deny('git reset --hard descarta trabajo');
      if (sub === 'clean' && vals.some((v) => /^-[^-]*f/.test(v)))
        deny('git clean destruye untracked');
      if (
        sub === 'restore' &&
        (!vals.includes('--staged') || vals.includes('--worktree') || vals.includes('-W'))
      )
        deny('git restore descarta trabajo');
      if (
        sub === 'checkout' &&
        (vals.some((v) => ['--', '-f', '--force', '.'].includes(v)) ||
          (!vals.includes('-b') && vals.length > 1))
      )
        deny('checkout puede descartar archivos');
      if (sub === 'switch' && vals.includes('--discard-changes')) deny('switch descarta trabajo');
      if (sub === 'branch' && vals.includes('-D')) deny('Borrado forzado de rama');
      if (
        sub === 'add' &&
        vals.some((v) => ['-A', '--all', '-u', '--update', '.', '*', ':/'].includes(v))
      )
        deny('Staging requiere rutas explícitas');
      if (sub === 'commit' && vals.some((v) => /^-[^-]*a/.test(v) || v === '--all'))
        deny('Commit requiere staging explícito');
      if (['commit', 'push', 'merge'].includes(sub) && vals.includes('--no-verify'))
        deny('No omitir hooks');
      if (
        sub === 'push' &&
        vals.some(
          (v) =>
            ['--force', '-f', 'main', 'master'].includes(v) ||
            /:(?:refs\/heads\/)?(main|master)$/.test(v),
        )
      )
        deny('Push forzado o directo a rama principal');
    }
    const vals = args.map((arg) => arg.value);
    const text = [program, ...vals].join(' ');
    if (
      ['pnpm', 'prisma'].includes(program) &&
      /\bprisma\s+(migrate\s+reset|db\s+push)\b/.test(text)
    )
      deny('Usa migraciones nuevas, nunca reset/db push');
    if (['psql', 'pgcli'].includes(program) || /\bprisma\s+db\s+execute\b/.test(text)) {
      if (
        /\b(drop\s+(database|schema|table)|truncate\b)/i.test(text) ||
        /\bdelete\s+from\s+[\w.]+\s*(;|$)/i.test(text)
      )
        deny('SQL destructivo');
    }
    if (
      program === 'docker' &&
      ((vals.includes('down') && vals.some((v) => v === '-v' || v === '--volumes')) ||
        /\b(volume (rm|prune)|system prune)\b/.test(text))
    )
      deny('No borrar volúmenes/datos');
    if (['npm', 'yarn', 'bun', 'npx'].includes(program)) deny('Este repo usa pnpm');
    if (program === 'chmod' && vals.some((v) => /^0?777$/.test(v))) deny('No usar permisos 777');
    if (program === 'tee' || ['cat', 'head', 'tail'].includes(program)) {
      for (const arg of args.filter((arg) => !arg.value.startsWith('-'))) {
        if (arg.glob || arg.value.startsWith('~'))
          deny('Lectura/escritura requiere rutas literales verificables');
        const reason = inspectPath(arg.value, {
          projectDir,
          cwd: currentDir,
          write: program === 'tee',
        });
        if (reason) deny(reason);
      }
    }
    previousProgram = program;
    segment = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind === 'word') {
      segment.push(token);
      continue;
    }
    if (['>', '>>', '<'].includes(token.value)) {
      const target = tokens[++i];
      if (target?.kind !== 'word' || target.glob || target.value.startsWith('~'))
        deny('Redirección no verificable');
      const reason = inspectPath(target.value, {
        projectDir,
        cwd: currentDir,
        write: token.value !== '<',
      });
      if (reason) deny(reason);
      continue;
    }
    run();
    pipe = token.value === '|';
  }
  run();
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  checkCommand(input?.tool_input?.command, { projectDir, cwd: input?.cwd ?? projectDir });
} catch (error) {
  process.stderr.write(`Comando bloqueado: ${error.message}\n`);
  process.exitCode = 2;
}
