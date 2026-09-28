/**
 * Tests de plans:lint / plans:status (`pnpm test:harness`). Cada test arma un plans/ temporal.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { declaredFiles, listInitiatives, loadAll, loadFindings } from './lib.mjs';
import { lintRepo } from './lint.mjs';

const PLANS = path.join(import.meta.dirname, '../../plans');
const TEMPLATE = readFileSync(path.join(PLANS, '_TEMPLATE.md'), 'utf8');
const INITIATIVE = readFileSync(path.join(PLANS, '_INITIATIVE.md'), 'utf8');
const MODULES = ['employees', 'attendance', 'payroll', 'platform'];
const roots = [];
after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

/** Plan válido a partir de la plantilla real, con overrides de frontmatter y secciones. */
function plan({ status = 'draft', module = 'employees', deps = '[]', fill = {} } = {}) {
  let text = TEMPLATE.replace(/^status: .*$/m, `status: ${status}`)
    .replace(/^module: .*$/m, `module: ${module}`)
    .replace(/^depends_on: .*$/m, `depends_on: ${deps}`);
  for (const [section, content] of Object.entries(fill)) {
    text = text.replace(new RegExp(`(## ${section}\\n)`), `$1\n${content}\n`);
  }
  return text;
}

function finding({ status = 'open', module = 'payroll', planRef } = {}) {
  return `---\nstatus: ${status}\nmodule: ${module}\nfound: 2026-09-26\n${planRef ? `plan: ${planRef}\n` : ''}---\n\n# Hallazgo: x\n`;
}

function write(files) {
  const root = mkdtempSync(path.join(tmpdir(), 'plans-test-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
  }
  return root;
}

function lint(files) {
  const root = write(files);
  return lintRepo({
    plans: loadAll(root),
    initiatives: listInitiatives(root),
    findings: loadFindings(root),
    modules: MODULES,
  });
}

const EVIDENCE = {
  'Out of scope': 'Nothing beyond the listed files.',
  Deviations: 'None',
  'Test coverage': '| x | y | domain | t | CONFIRMED |',
  'Review findings': 'All passed.',
  Verification: 'curl → 201.',
};
const readme = { 'employees-desvinculacion/README.md': INITIATIVE };

describe('plans:lint — estructura', () => {
  it('acepta una iniciativa con README y un plan draft de la plantilla', () => {
    assert.deepEqual(lint({ ...readme, 'employees-desvinculacion/001-agregado.md': plan() }), []);
  });

  it('rechaza planes sueltos en plans/', () => {
    assert.ok(lint({ '001-suelto.md': plan() }).some((e) => e.includes('plan suelto')));
  });

  it('exige README en cada iniciativa', () => {
    const errors = lint({ 'employees-x/001-a.md': plan() });
    assert.ok(errors.some((e) => e.includes('falta README.md')));
  });

  it('exige que la iniciativa empiece con un módulo del registro', () => {
    const errors = lint({ 'nomina-x/README.md': INITIATIVE, 'nomina-x/001-a.md': plan() });
    assert.ok(errors.some((e) => e.includes('<modulo>-<tema>')));
  });

  it('exige que el module del plan coincida con la iniciativa', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan({ module: 'payroll' }),
    });
    assert.ok(errors.some((e) => e.includes('no coincide con la iniciativa')));
  });

  it('rechaza slugs con tildes o mayúsculas', () => {
    const errors = lint({ ...readme, 'employees-desvinculacion/001-Liquidación.md': plan() });
    assert.ok(errors.some((e) => e.includes('NNN-slug.md')));
  });

  it('detecta números duplicados en la misma iniciativa', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan(),
      'employees-desvinculacion/001-b.md': plan(),
    });
    assert.ok(errors.some((e) => e.includes('duplicado')));
  });
});

describe('plans:lint — frontmatter y evidencia', () => {
  it('rechaza status y module desconocidos', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan({ status: 'wip' }),
    });
    assert.ok(errors.some((e) => e.includes('status inválido')));
  });

  it('exige evidencia según el status (testing sin Deviations)', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan({
        status: 'testing',
        fill: { 'Out of scope': 'x' },
      }),
    });
    assert.ok(errors.some((e) => e.includes('## Deviations')));
  });

  it('acepta done con toda la evidencia', () => {
    const files = {
      ...readme,
      'employees-desvinculacion/001-a.md': plan({ status: 'done', fill: EVIDENCE }),
    };
    assert.deepEqual(lint(files), []);
  });

  it('resuelve depends_on dentro y entre iniciativas', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan({
        status: 'approved',
        fill: { 'Out of scope': 'x' },
      }),
      'employees-desvinculacion/002-b.md': plan({
        status: 'done',
        deps: '["001"]',
        fill: EVIDENCE,
      }),
      'payroll-liquidacion/README.md': INITIATIVE,
      'payroll-liquidacion/001-c.md': plan({
        module: 'payroll',
        deps: '["employees-desvinculacion/001"]',
      }),
      'payroll-liquidacion/002-d.md': plan({
        module: 'payroll',
        deps: '["employees-desvinculacion/009"]',
      }),
    });
    assert.ok(errors.some((e) => e.includes('002-b.md') && e.includes('dependencia')));
    assert.ok(errors.some((e) => e.includes('002-d.md') && e.includes('no existe')));
    assert.ok(!errors.some((e) => e.includes('001-c.md')));
  });

  it('detecta secciones faltantes', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan().replace('## Out of scope', '## Fuera'),
    });
    assert.ok(errors.some((e) => e.includes('## Out of scope')));
  });
});

describe('plans:lint — hallazgos', () => {
  it('acepta un hallazgo abierto válido', () => {
    assert.deepEqual(lint({ 'hallazgos/payroll-redondeo-uf.md': finding() }), []);
  });

  it('planned exige un plan existente', () => {
    const errors = lint({
      'hallazgos/payroll-redondeo-uf.md': finding({ status: 'planned', planRef: 'payroll-x/001' }),
    });
    assert.ok(errors.some((e) => e.includes('exige plan')));
  });

  it('rechaza status y módulo inválidos', () => {
    const errors = lint({ 'hallazgos/x.md': finding({ status: 'todo', module: 'nomina' }) });
    assert.ok(errors.some((e) => e.includes('status inválido')));
    assert.ok(errors.some((e) => e.includes('no está en el registro')));
  });

  it('los hallazgos no se confunden con planes', () => {
    assert.equal(loadAll(write({ 'hallazgos/payroll-x.md': finding() })).length, 0);
  });
});

describe('declaredFiles (base de plans:scope)', () => {
  it('lee solo las rutas en backticks de las líneas Files:', () => {
    const text = plan().replace(
      /## Steps\n[\s\S]*?(?=## Acceptance)/,
      '## Steps\n\n1. **X**\n   - Files: `apps/api/src/a.ts` (create), `packages/contracts/src/b.ts` (modify)\n   - Do: usar `Result` y `pnpm check`\n\n',
    );
    const [parsed] = loadAll(write({ 'employees-x/001-a.md': text }));
    assert.deepEqual([...declaredFiles(parsed)].sort(), [
      'apps/api/src/a.ts',
      'packages/contracts/src/b.ts',
    ]);
  });
});

describe('dependencias de ejecución', () => {
  for (const status of ['implementing', 'testing', 'review', 'verify', 'done']) {
    it(`${status} exige dependencias done`, () => {
      const errors = lint({
        ...readme,
        'employees-desvinculacion/001-a.md': plan({ status: 'approved', fill: EVIDENCE }),
        'employees-desvinculacion/002-b.md': plan({ status, deps: '["001"]', fill: EVIDENCE }),
      });
      assert.ok(errors.some((error) => error.includes('dependencia')));
    });
  }
  it('rechaza ciclos incluso en draft', () => {
    const errors = lint({
      ...readme,
      'employees-desvinculacion/001-a.md': plan({ deps: '["002"]' }),
      'employees-desvinculacion/002-b.md': plan({ deps: '["001"]' }),
    });
    assert.ok(errors.some((error) => /ciclo/i.test(error)));
  });
});
