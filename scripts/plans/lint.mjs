#!/usr/bin/env node
/**
 * `pnpm plans:lint` — valida estructura, formato y coherencia estado/evidencia de planes,
 * iniciativas y hallazgos. Reglas: docs/harness/conventions/plans.md → "What pnpm plans:lint enforces".
 */
import {
  EVIDENCE_FROM,
  FINDING_STATUSES,
  PLANS_DIR,
  REQUIRED_SECTIONS,
  STATUSES,
  TIERS,
  initiativeModule,
  isEmptySection,
  listInitiatives,
  loadAll,
  loadFindings,
  reached,
  registryModules,
  resolveRef,
} from './lib.mjs';

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** @param {{ plans, initiatives, findings, modules }} repo */
export function lintRepo({ plans, initiatives, findings, modules }) {
  const errors = [];
  const report = (where, message) => errors.push(`${where}: ${message}`);

  // ── Iniciativas ──────────────────────────────────────────────────────
  for (const initiative of initiatives) {
    const where = `plans/${initiative.name}/`;
    if (!SLUG.test(initiative.name)) report(where, 'nombre en kebab-case ASCII sin tildes');
    if (!initiativeModule(initiative.name, modules)) {
      report(where, 'debe llamarse <modulo>-<tema> con un módulo de docs/harness/modules.json');
    }
    if (!initiative.hasReadme) report(where, 'falta README.md (plantilla plans/_INITIATIVE.md)');
  }

  // ── Planes ───────────────────────────────────────────────────────────
  const seen = new Map();
  for (const plan of plans) {
    const where = plan.rel;
    const fileName = plan.relToPlans.split('/').pop();

    if (!plan.dir) {
      report(where, 'plan suelto: debe vivir en plans/<modulo>-<tema>/');
    } else if (plan.dir.includes('/')) {
      report(where, 'solo un nivel: plans/<iniciativa>/NNN-slug.md');
    }
    if (!/^\d{3}-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(fileName)) {
      report(where, 'nombre NNN-slug.md (slug en kebab-case ASCII sin tildes)');
    }
    if (plan.num) {
      if (seen.has(plan.id)) report(where, `número duplicado con ${seen.get(plan.id)}`);
      else seen.set(plan.id, where);
    }

    if (plan.frontmatterError) {
      report(where, `frontmatter YAML inválido: ${plan.frontmatterError}`);
      continue;
    }
    if (!plan.frontmatter) {
      report(where, 'falta el frontmatter (status/module/min_implementer/depends_on)');
      continue;
    }

    const fm = plan.frontmatter;
    const owner = initiativeModule(plan.initiative, modules);
    if (!STATUSES.includes(fm.status)) report(where, `status inválido "${fm.status}"`);
    if (!modules.includes(fm.module)) {
      report(where, `module "${fm.module}" no está en docs/harness/modules.json`);
    } else if (owner && fm.module !== owner) {
      report(where, `module "${fm.module}" no coincide con la iniciativa (${owner})`);
    }
    if (!TIERS.includes(fm.min_implementer)) {
      report(where, `min_implementer inválido "${fm.min_implementer}" (small | mid | high)`);
    }
    if (!Array.isArray(fm.depends_on))
      report(where, 'depends_on debe ser una lista ([] si no hay)');
    if (fm.superseded_by && fm.status !== 'superseded') {
      report(where, 'superseded_by solo se usa con status: superseded');
    }

    for (const ref of Array.isArray(fm.depends_on) ? fm.depends_on : []) {
      const target = resolveRef(plan, ref, plans);
      if (!target) report(where, `depends_on "${ref}" no existe`);
      else if (target === plan) report(where, 'un plan no puede depender de sí mismo');
      else if (fm.status === 'done' && target.frontmatter?.status !== 'done') {
        report(where, `está done pero su dependencia ${target.id} no`);
      }
    }

    const positions = REQUIRED_SECTIONS.map((name) => plan.order.indexOf(name));
    REQUIRED_SECTIONS.forEach((name, i) => {
      if (positions[i] === -1) report(where, `falta la sección "## ${name}"`);
    });
    const present = positions.filter((position) => position !== -1);
    if (present.some((position, i) => i > 0 && position < (present[i - 1] ?? -1))) {
      report(where, `las secciones no siguen el orden: ${REQUIRED_SECTIONS.join(' → ')}`);
    }

    for (const [section, from] of Object.entries(EVIDENCE_FROM)) {
      if (reached(fm.status, from) && isEmptySection(plan.sections.get(section))) {
        report(where, `status ${fm.status} exige "## ${section}" completo (evidencia en el plan)`);
      }
    }
    if (
      !['draft', 'superseded'].includes(fm.status) &&
      isEmptySection(plan.sections.get('Out of scope'))
    ) {
      report(where, '"## Out of scope" vacío: es la cerca del implementador');
    }
  }

  // ── Hallazgos ────────────────────────────────────────────────────────
  for (const finding of findings) {
    const where = finding.rel;
    if (!SLUG.test(finding.slug)) report(where, 'nombre <modulo>-<slug>.md en kebab-case ASCII');
    if (finding.frontmatterError) {
      report(where, `frontmatter YAML inválido: ${finding.frontmatterError}`);
      continue;
    }
    const fm = finding.frontmatter;
    if (!fm) {
      report(where, 'falta el frontmatter (status/module/found); plantilla plans/_FINDING.md');
      continue;
    }
    if (!FINDING_STATUSES.includes(fm.status)) {
      report(where, `status inválido "${fm.status}" (${FINDING_STATUSES.join(' | ')})`);
    }
    if (!modules.includes(fm.module)) report(where, `module "${fm.module}" no está en el registro`);
    const found = fm.found instanceof Date ? fm.found.toISOString().slice(0, 10) : String(fm.found);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(found)) report(where, 'found debe ser una fecha AAAA-MM-DD');
    if (['planned', 'resolved'].includes(fm.status)) {
      const [dir, num] = String(fm.plan ?? '').split('/');
      const target = plans.find((plan) => plan.dir === dir && plan.num === num?.padStart(3, '0'));
      if (!target) report(where, `status ${fm.status} exige plan: <iniciativa>/NNN existente`);
    }
  }

  return errors;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const repo = {
    plans: loadAll(),
    initiatives: listInitiatives(PLANS_DIR),
    findings: loadFindings(),
    modules: registryModules(),
  };
  const errors = lintRepo(repo);
  if (errors.length > 0) {
    console.error(`✖ plans:lint — ${errors.length} problema(s):\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }
  console.log(
    `✔ plans:lint — ${repo.plans.length} plan(es) en ${repo.initiatives.length} iniciativa(s), ` +
      `${repo.findings.length} hallazgo(s)`,
  );
}
