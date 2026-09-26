#!/usr/bin/env node
/**
 * PreToolUse(Bash): bloquea comandos destructivos o que rompen las convenciones del repo.
 *
 * Protocolo de hooks de Claude Code: recibe JSON por stdin ({ tool_input, cwd, transcript_path });
 * salir con código 2 BLOQUEA la herramienta y stderr se le devuelve al agente.
 *
 * Cada regla dice POR QUÉ se bloquea y QUÉ hacer en su lugar: un bloqueo sin alternativa solo
 * hace que el agente intente rodearlo. Las reglas de git/rm vienen de incidentes reales
 * (docs/harness/HARNESS.md → Destructive actions).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

/** Directorios desechables: se regeneran solos, se pueden borrar recursivamente. */
const DISPOSABLE =
  /^(\.\/)?([\w.-]+\/)*(node_modules|dist|build|\.next|\.turbo|\.expo|coverage|generated|web-build|out)\/?$/;

/**
 * El texto entre comillas es un ARGUMENTO (grep "…", git commit -m "…", heredocs de scripts),
 * no un comando: la mayoría de las reglas se evalúan sobre el comando sin ese contenido.
 */
const stripQuoted = (cmd) => {
  // Un heredoc hacia una shell (bash <<EOF) SÍ son comandos: se conserva para evaluarlo.
  const withoutHeredocs = /\b(ba|z|fi)?sh\s+(-\w+\s+)*<</.test(cmd)
    ? cmd
    : cmd.replace(/<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1(\n|$)/g, '<<HEREDOC\n');
  return withoutHeredocs.replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '""');
};

const splitCommands = (cmd) => cmd.split(/&&|\|\||;|\||\n/).map((part) => part.trim());
const tokens = (part) => part.split(/\s+/).filter(Boolean);

/** Contexto de la invocación, para reglas que miran el sistema de archivos. */
const ctx = { cwd: PROJECT_DIR, transcript: null };

function isInsideProject(abs) {
  const rel = path.relative(PROJECT_DIR, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isUntracked(abs) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', abs], {
    cwd: PROJECT_DIR,
    stdio: 'ignore',
  });
  return result.status !== 0;
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ¿Este archivo lo creó ESTA sesión? Busca en el transcript:
 *  - la herramienta Write con ese file_path, o
 *  - un comando Bash que ESCRIBIÓ en esa ruta (>, >>, tee, open(…,'w'), writeFileSync).
 * Leerlo (cat, grep, Read) no cuenta como crearlo.
 */
function createdThisSession(abs) {
  if (!ctx.transcript) return false;
  const lines = ctx.transcript.split('\n');

  const absJson = JSON.stringify(abs).slice(1, -1);
  if (lines.some((line) => line.includes('"Write"') && line.includes(`"file_path":"${absJson}"`))) {
    return true;
  }

  const variants = [abs, path.relative(PROJECT_DIR, abs)].map((p) =>
    escapeRegex(JSON.stringify(p).slice(1, -1)),
  );
  const quote = `(?:\\\\?["'])?`; // comillas opcionales, escapadas o no dentro del JSON
  const writers = variants.flatMap((p) => [
    new RegExp(`>{1,2}\\s*${quote}${p}(?![\\w./-])`),
    new RegExp(`\\btee\\s+(?:-a\\s+)?${quote}${p}(?![\\w./-])`),
    new RegExp(`\\bopen\\(\\s*${quote}${p}${quote}\\s*,\\s*${quote}[wax]`),
    new RegExp(`\\bwriteFileSync\\(\\s*${quote}${p}(?![\\w./-])`),
  ]);
  // En el JSON, los saltos de línea del comando llegan como el texto `\n`: se normalizan a
  // espacios para que `\b` funcione (si no, "\nopen(" se lee como la palabra "nopen").
  return lines.some((line) => {
    if (!line.includes('"Bash"')) return false;
    const text = line.replace(/\\[ntr]/g, ' ');
    return writers.some((writer) => writer.test(text));
  });
}

function rmViolation(part) {
  const words = tokens(part);
  const start = words[0] === 'sudo' ? 1 : 0;
  if (words[start] !== 'rm') return null;
  const args = words.slice(start + 1);
  const flags = args.filter((word) => word.startsWith('-')).join('');
  const targets = args.filter((word) => !word.startsWith('-'));
  const recursive = /r|R|--recursive/.test(flags);

  if (targets.length === 0) return null;
  if (targets.some((target) => /[*?[\]{}]/.test(target))) return 'glob';
  if (recursive) return targets.some((target) => !DISPOSABLE.test(target)) ? 'recursive' : null;

  for (const target of targets) {
    const abs = path.resolve(ctx.cwd, target.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
    if (!isInsideProject(abs) || !existsSync(abs)) continue;
    if (isUntracked(abs) && !createdThisSession(abs)) return 'untracked';
  }
  return null;
}

/**
 * `raw: true` → la regla necesita ver el contenido entre comillas (SQL dentro de psql -c "…").
 * @type {{ id: string, raw?: boolean, test: (cmd: string) => boolean, reason: string }[]}
 */
const RULES = [
  // ── Borrado de archivos ────────────────────────────────────────────────
  {
    id: 'rm-recursive',
    test: (cmd) => splitCommands(cmd).some((part) => rmViolation(part) === 'recursive'),
    reason:
      'Borrado recursivo fuera de directorios desechables (node_modules, dist, .next, .turbo, ' +
      '.expo, coverage, generated). Borra archivos puntuales por ruta o pide confirmación.',
  },
  {
    id: 'rm-glob',
    test: (cmd) => splitCommands(cmd).some((part) => rmViolation(part) === 'glob'),
    reason:
      'rm con comodines puede arrasar archivos del usuario. Borra por ruta explícita, uno a uno.',
  },
  {
    id: 'rm-untracked',
    test: (cmd) => splitCommands(cmd).some((part) => rmViolation(part) === 'untracked'),
    reason:
      'El archivo no está versionado y no lo creaste en esta sesión: git no podría recuperarlo. ' +
      'Untracked (??) NO significa desechable. Déjalo y menciónalo al usuario.',
  },
  {
    id: 'find-delete',
    test: (cmd) => /\bfind\b[^|;&]*(\s-delete\b|-exec\s+rm\b)/.test(cmd),
    reason: 'Borrado masivo con find. Borra por ruta explícita o pide confirmación al usuario.',
  },

  // ── Git: historia y trabajo sin commitear ──────────────────────────────
  {
    id: 'git-force-push',
    test: (cmd) => /\bgit\s+push\b[^|;&]*(\s--force(?!-with-lease)\b|\s-f\b)/.test(cmd),
    reason:
      'git push --force reescribe historia remota. Usa --force-with-lease en TU rama, nunca en main.',
  },
  {
    id: 'git-push-main',
    test: (cmd) => /\bgit\s+push\b[^|;&]*\b(origin\s+)?(main|master)\b/.test(cmd),
    reason: 'No se hace push directo a main. Crea una rama y abre un PR.',
  },
  {
    id: 'git-discard',
    test: (cmd) =>
      /\bgit\s+reset\s+[^|;&]*--hard\b/.test(cmd) ||
      /\bgit\s+clean\s+[^|;&]*-[a-z]*f/.test(cmd) ||
      /\bgit\s+checkout\b[^|;&]*\s--(\s|$)/.test(cmd) ||
      /\bgit\s+checkout\s+(-f|--force)\b/.test(cmd) ||
      /\bgit\s+checkout\s+\.(\s|$)/.test(cmd) ||
      /\bgit\s+switch\b[^|;&]*--discard-changes\b/.test(cmd) ||
      splitCommands(cmd).some((part) => {
        const words = tokens(part);
        if (words[0] !== 'git' || words[1] !== 'restore') return false;
        // `git restore --staged <f>` solo quita del stage (no pierde nada); el resto descarta.
        return !(
          words.includes('--staged') &&
          !words.includes('--worktree') &&
          !words.includes('-W')
        );
      }),
    reason:
      'Descarta cambios sin commitear de forma irreversible (tuyos, del usuario o de otro agente ' +
      'en el mismo worktree). Para comparar contra HEAD usa el baseline por scratchpad de ' +
      'docs/harness/HARNESS.md (git show HEAD:<ruta> > <ruta> solo en TUS archivos).',
  },
  {
    id: 'git-stash',
    test: (cmd) => /\bgit\s+stash\b(?!\s+(list|show)\b)/.test(cmd),
    reason:
      'git stash se lleva TODOS los cambios del worktree (también los de otros agentes) y la pila ' +
      'es compartida. Usa el baseline por scratchpad de docs/harness/HARNESS.md.',
  },
  {
    id: 'git-add-all',
    test: (cmd) =>
      /\bgit\s+add\s+([^|;&]*\s)?(-A|--all|-u|--update|\.|\*|:\/)(\s|$)/.test(cmd) ||
      /\bgit\s+commit\b[^|;&]*\s(-(?!-)[a-zA-Z]*a[a-zA-Z]*|--all)(\s|$)/.test(cmd),
    reason:
      'Staging masivo: se llevaría cambios del usuario u otros agentes que no son de esta fase. ' +
      'Agrega rutas explícitas (git add <ruta> <ruta>) y revisa git diff --cached --stat ' +
      '(docs/harness/conventions/commits.md).',
  },
  {
    id: 'git-branch-delete',
    test: (cmd) => /\bgit\s+branch\s+[^|;&]*-D\b/.test(cmd),
    reason: 'Borrar ramas sin merge pierde commits. Pide confirmación al usuario.',
  },
  {
    id: 'no-verify',
    test: (cmd) => /\bgit\s+(commit|push|merge)\b[^|;&]*--no-verify\b/.test(cmd),
    reason:
      '--no-verify salta los hooks de calidad (lint-staged, commitlint). Corrige lo que reporta ' +
      'el hook en vez de saltarlo.',
  },

  // ── Base de datos ──────────────────────────────────────────────────────
  {
    id: 'prisma-reset',
    test: (cmd) =>
      /\bprisma\s+migrate\s+reset\b/.test(cmd) ||
      /\bprisma\s+db\s+push\b[^|;&]*(--force-reset|--accept-data-loss)/.test(cmd),
    reason:
      'Borra todos los datos de la base. Para cambios de esquema usa `pnpm db:migrate` (crea una ' +
      'migración nueva). Si de verdad hay que resetear, lo hace el usuario.',
  },
  {
    id: 'prisma-db-push',
    test: (cmd) => /\bprisma\s+db\s+push\b/.test(cmd),
    reason:
      'db push cambia el esquema sin migración versionada. Usa `pnpm db:migrate --name <cambio>`.',
  },
  {
    id: 'sql-destructive',
    raw: true,
    test: (cmd) =>
      /\b(psql|pgcli|prisma\s+db\s+execute)\b/.test(cmd) &&
      (/\b(drop\s+(database|schema|table)|truncate\s+(table\s+)?\w)/i.test(cmd) ||
        /\bdelete\s+from\s+[\w.]+\s*(;|"|'|$)/i.test(cmd)),
    reason:
      'SQL destructivo (DROP/TRUNCATE/DELETE sin WHERE). Los cambios de esquema van por migraciones.',
  },

  // ── Docker: volúmenes = datos ──────────────────────────────────────────
  {
    id: 'docker-volumes',
    test: (cmd) =>
      /\bdocker\s+compose\b[^|;&]*\bdown\b[^|;&]*(\s-v\b|--volumes)/.test(cmd) ||
      /\bdocker\s+volume\s+(rm|prune)\b/.test(cmd) ||
      /\bdocker\s+system\s+prune\b/.test(cmd),
    reason: 'Borra los volúmenes con los datos de desarrollo. Usa `pnpm db:down` (conserva datos).',
  },

  // ── Convenciones del repo ──────────────────────────────────────────────
  {
    id: 'package-manager',
    test: (cmd) =>
      /(^|[\s;&|(])(npm|yarn|bun)\s+(i|install|add|remove|ci|run)\b/.test(cmd) ||
      /(^|[\s;&|(])npx\s/.test(cmd),
    reason:
      'Este monorepo usa SOLO pnpm. Equivalencias: npm install → pnpm install, ' +
      'npm i X → pnpm --filter <paquete> add X, npx X → pnpm exec X (o pnpm dlx X). ' +
      'En apps/mobile las libs nativas se agregan con `pnpm exec expo install <lib>`.',
  },
  {
    id: 'pipe-to-shell',
    test: (cmd) => /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z|fi)?sh\b/.test(cmd),
    reason:
      'Ejecutar scripts remotos sin revisarlos no está permitido. Descárgalo y muéstraselo al usuario.',
  },
  {
    id: 'sudo',
    test: (cmd) => /(^|[\s;&|(])sudo\s/.test(cmd),
    reason: 'No se usa sudo desde el agente. Si hace falta, indícale al usuario el comando exacto.',
  },
  {
    id: 'chmod-777',
    test: (cmd) => /\bchmod\s+(-R\s+)?0?777\b/.test(cmd),
    reason: 'Permisos 777 son un riesgo de seguridad. Usa permisos mínimos.',
  },
];

function main() {
  let input;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0); // Entrada inesperada: no bloquear por un fallo del propio hook.
  }

  ctx.cwd = input?.cwd ?? PROJECT_DIR;
  try {
    if (input?.transcript_path) ctx.transcript = readFileSync(input.transcript_path, 'utf8');
  } catch {
    ctx.transcript = null; // Sin transcript: se asume que nada fue creado en la sesión.
  }

  const command = String(input?.tool_input?.command ?? '');
  const unquoted = stripQuoted(command);
  const violated = RULES.filter((rule) => rule.test(rule.raw ? command : unquoted));
  if (violated.length === 0) process.exit(0);

  const lines = violated.map((rule) => `  • [${rule.id}] ${rule.reason}`);
  process.stderr.write(
    `⛔ Comando bloqueado por .claude/hooks/guard-bash.mjs\n${lines.join('\n')}\n` +
      'Si el usuario lo pidió explícitamente, pídele que lo ejecute él mismo.\n',
  );
  process.exit(2);
}

main();
