#!/usr/bin/env node
/**
 * `pnpm plans:status [iniciativa] [--all]` — vista calculada desde el frontmatter de los planes
 * (y hallazgos abiertos), ordenada por lo que necesita atención. Nunca se mantiene a mano.
 */
import { loadAll, loadFindings, resolveRef } from './lib.mjs';

const NEXT = {
  blocked: ['0', 'Informar el motivo al usuario (Deviations / depends_on); no rodearlo'],
  draft: ['1', 'Usuario: revisar y aprobar (status: approved)'],
  verify: ['2', 'Verificar en la app (skill verificar / subagente verifier)'],
  review: ['3', 'Revisar (subagente reviewer / skill revisar)'],
  testing: ['4', 'Escribir tests (skill escribir-tests / subagente tester)'],
  implementing: ['5', 'Retomar implementación (ver Deviations)'],
  approved: ['6', 'Implementar (skill implementar / subagente implementer)'],
  done: ['8', '—'],
  superseded: ['9', '—'],
};

const args = process.argv.slice(2);
const showAll = args.includes('--all');
const filter = args
  .find((arg) => !arg.startsWith('--'))
  ?.replace(/^plans\//, '')
  .replace(/\/$/, '');

const plans = loadAll();
const scoped = filter ? plans.filter((plan) => plan.initiative === filter) : plans;

if (filter && scoped.length === 0) {
  console.error(`No hay planes en plans/${filter}/`);
  process.exit(1);
}

const rows = scoped
  .map((plan) => {
    const fm = plan.frontmatter ?? {};
    const status = fm.status ?? '???';
    const unmet = (Array.isArray(fm.depends_on) ? fm.depends_on : [])
      .filter((ref) => resolveRef(plan, ref, plans)?.frontmatter?.status !== 'done')
      .map(String);
    let [priority, action] = NEXT[status] ?? ['0', 'Frontmatter inválido: correr pnpm plans:lint'];
    if (['approved', 'implementing'].includes(status) && unmet.length > 0) {
      priority = '0';
      action = `Bloqueado por depends_on sin terminar: ${unmet.join(', ')}`;
    }
    return { plan, status, priority, action, fm };
  })
  .sort((a, b) => a.priority.localeCompare(b.priority) || a.plan.id.localeCompare(b.plan.id));

const visible = showAll ? rows : rows.filter((row) => !['done', 'superseded'].includes(row.status));
const hidden = rows.length - visible.length;

if (rows.length === 0) {
  console.log(
    'No hay planes todavía. Crea uno con la skill `planear` (plantillas en plans/_*.md).',
  );
} else if (visible.length > 0) {
  console.table(
    visible.map((row) => ({
      plan: row.plan.id,
      status: row.status,
      tier: row.fm.min_implementer ?? '?',
      title: row.plan.title.replace(/^\d{3}\s*[—-]\s*/, '').slice(0, 50),
      next: row.action,
    })),
  );
}
if (hidden > 0) console.log(`(${hidden} planes done/superseded ocultos; usa --all para verlos)`);

if (!filter) {
  const open = loadFindings().filter((finding) => finding.frontmatter?.status === 'open');
  if (open.length > 0) {
    console.log(
      `\nHallazgos abiertos (${open.length}) — el usuario decide: deferred / planned / discarded`,
    );
    for (const finding of open) console.log(`  • ${finding.rel} — ${finding.title}`);
  }
}
