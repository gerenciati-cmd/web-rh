/**
 * Lectura de planes, iniciativas y hallazgos (plans/**), compartida por plans:status,
 * plans:lint y plans:scope. Formato: docs/harness/conventions/plans.md.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const PLANS_DIR = path.join(ROOT, 'plans');
export const FINDINGS_DIR_NAME = 'hallazgos';

export const STATUSES = [
  'draft',
  'approved',
  'implementing',
  'testing',
  'review',
  'verify',
  'blocked',
  'done',
  'superseded',
];
export const TIERS = ['small', 'mid', 'high'];
export const FINDING_STATUSES = ['open', 'deferred', 'planned', 'resolved', 'discarded'];

export const REQUIRED_SECTIONS = [
  'Context',
  'Out of scope',
  'Dependencies',
  'Steps',
  'Acceptance criteria',
  'Test layers required',
  'Deviations',
  'Test coverage',
  'Review findings',
  'Verification',
];

/** Sección de evidencia → primer estado desde el que debe estar llena. */
export const EVIDENCE_FROM = {
  Deviations: 'testing',
  'Test coverage': 'review',
  'Review findings': 'verify',
  Verification: 'done',
};

/** Orden del pipeline (blocked/superseded quedan fuera: no implican evidencia). */
const PIPELINE = ['draft', 'approved', 'implementing', 'testing', 'review', 'verify', 'done'];

export function reached(status, target) {
  const current = PIPELINE.indexOf(status);
  return current !== -1 && current >= PIPELINE.indexOf(target);
}

export const isTemplate = (name) => name.startsWith('_');
const isMarkdownDoc = (name) => name.endsWith('.md') && !isTemplate(name) && name !== 'README.md';

function readFrontmatter(file) {
  const raw = readFileSync(file, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: null, frontmatterError: null, body: raw };
  try {
    return { frontmatter: parseYaml(match[1]) ?? {}, frontmatterError: null, body: match[2] };
  } catch (error) {
    return { frontmatter: null, frontmatterError: String(error.message ?? error), body: match[2] };
  }
}

/** Planes: *.md bajo plans/ (fuera de hallazgos/), excepto plantillas y README.md. */
export function listPlanFiles(plansDir = PLANS_DIR, dir = plansDir) {
  let files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (dir === plansDir && entry === FINDINGS_DIR_NAME) continue;
      files = files.concat(listPlanFiles(plansDir, full));
    } else if (isMarkdownDoc(entry)) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Iniciativas: directorios de primer nivel de plans/ (excepto hallazgos/). */
export function listInitiatives(plansDir = PLANS_DIR) {
  return readdirSync(plansDir)
    .filter(
      (entry) => entry !== FINDINGS_DIR_NAME && statSync(path.join(plansDir, entry)).isDirectory(),
    )
    .map((name) => ({ name, hasReadme: existsSync(path.join(plansDir, name, 'README.md')) }));
}

export function parsePlan(file, plansDir = PLANS_DIR) {
  const { frontmatter, frontmatterError, body } = readFrontmatter(file);
  const relToPlans = path.relative(plansDir, file);
  const dir = path.dirname(relToPlans) === '.' ? '' : path.dirname(relToPlans);
  const num = path.basename(file).match(/^(\d{3})-/)?.[1] ?? null;

  const sections = new Map();
  const order = [];
  let current = null;
  for (const line of body.split('\n')) {
    const heading = line.match(/^## (.+?)\s*$/);
    if (heading) {
      current = heading[1];
      order.push(current);
      sections.set(current, []);
    } else if (current) {
      sections.get(current).push(line);
    }
  }

  return {
    file,
    rel: path.relative(ROOT, file),
    relToPlans,
    dir,
    initiative: dir.split(path.sep)[0] ?? '',
    num,
    id: dir ? `${dir}/${num}` : num,
    title: body.match(/^# (.+)$/m)?.[1] ?? path.basename(file),
    frontmatter,
    frontmatterError,
    sections: new Map([...sections].map(([name, lines]) => [name, lines.join('\n')])),
    order,
  };
}

export function loadAll(plansDir = PLANS_DIR) {
  return listPlanFiles(plansDir).map((file) => parsePlan(file, plansDir));
}

export function loadFindings(plansDir = PLANS_DIR) {
  const dir = path.join(plansDir, FINDINGS_DIR_NAME);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(isMarkdownDoc)
    .sort()
    .map((entry) => {
      const file = path.join(dir, entry);
      const { frontmatter, frontmatterError, body } = readFrontmatter(file);
      return {
        file,
        rel: path.relative(ROOT, file),
        slug: entry.replace(/\.md$/, ''),
        title: body.match(/^# (.+)$/m)?.[1] ?? entry,
        frontmatter,
        frontmatterError,
      };
    });
}

/** Una sección está "vacía" si solo tiene comentarios HTML y espacios. */
export function isEmptySection(text) {
  return (text ?? '').replace(/<!--[\s\S]*?-->/g, '').trim() === '';
}

/** Resuelve "002" (misma iniciativa) o "employees-desvinculacion/002" a un plan. */
export function resolveRef(plan, ref, plans) {
  const value = String(ref);
  const [refDir, refNum] = value.includes('/')
    ? [path.dirname(value), path.basename(value).padStart(3, '0')]
    : [plan.dir, value.padStart(3, '0')];
  return plans.find((candidate) => candidate.dir === refDir && candidate.num === refNum) ?? null;
}

/** Módulo dueño de una iniciativa según su prefijo (`attendance-marcaciones` → attendance). */
export function initiativeModule(initiative, moduleNames) {
  return (
    [...moduleNames]
      .sort((a, b) => b.length - a.length)
      .find((name) => initiative === name || initiative.startsWith(`${name}-`)) ?? null
  );
}

export function registryModules() {
  return JSON.parse(readFileSync(path.join(ROOT, 'docs/harness/modules.json'), 'utf8')).modules.map(
    (module) => module.name,
  );
}

/** Rutas en backticks de las líneas `Files:` de la sección Steps. */
export function declaredFiles(plan) {
  const steps = plan.sections.get('Steps') ?? '';
  const files = new Set();
  for (const line of steps.split('\n')) {
    if (!/files:/i.test(line)) continue;
    for (const [, candidate] of line.matchAll(/`([^`]+)`/g)) {
      if (/[/.]/.test(candidate) && !candidate.includes(' ')) {
        files.add(candidate.replace(/^\.\//, ''));
      }
    }
  }
  return files;
}
