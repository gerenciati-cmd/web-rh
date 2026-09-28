import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { parsePlan } from './lib.mjs';
import { evaluateScope } from './scope.mjs';
const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture({ commit = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'rrhh-scope-'));
  roots.push(root);
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args],
      { cwd: root, stdio: 'pipe', encoding: 'utf8' },
    );
  const write = (file, text = 'fixture\n') => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  };
  git('init', '-b', 'main');
  write('plans/test/001-test.md', '---\nstatus: approved\n---\n## Steps\n- Files: `allowed.ts`\n');
  write('allowed.ts');
  write('old name.ts');
  if (commit) {
    git('add', 'plans/test/001-test.md', 'allowed.ts', 'old name.ts');
    git('commit', '-m', 'fixture');
  }
  const plan = parsePlan(path.join(root, 'plans/test/001-test.md'));
  return { root, git, write, evaluate: (base = 'main') => evaluateScope({ root, plan, base }) };
}
test('comparación limpia y cambios permitidos', () => {
  const f = fixture();
  f.write('allowed.ts', 'change');
  assert.deepEqual(f.evaluate().outside, []);
});
test('falla sin HEAD o sin base', () => {
  assert.throws(() => fixture({ commit: false }).evaluate(), /No se pudo/);
  assert.throws(() => fixture().evaluate('absent'), /No se pudo/);
});
test('historia divergente desde ancestro común incluye commits de la rama', () => {
  const f = fixture();
  f.git('checkout', '-b', 'feature');
  f.write('committed.ts');
  f.git('add', 'committed.ts');
  f.git('commit', '-m', 'feature');
  f.git('checkout', 'main');
  f.write('base-only.ts');
  f.git('add', 'base-only.ts');
  f.git('commit', '-m', 'base');
  f.git('checkout', 'feature');
  assert.deepEqual(f.evaluate().outside, ['committed.ts']);
});
test('rechaza historias sin ancestro común', () => {
  const f = fixture();
  f.git('checkout', '--orphan', 'unrelated');
  f.git('commit', '-m', 'unrelated');
  assert.throws(() => f.evaluate(), /No se pudo/);
});
test('incluye staged, unstaged, untracked y nombres con saltos/espacios', () => {
  const f = fixture();
  f.write('old name.ts', 'changed');
  f.write('staged.ts');
  f.git('add', 'staged.ts');
  f.write('new name\nfile.ts');
  assert.deepEqual(f.evaluate().outside, ['new name\nfile.ts', 'old name.ts', 'staged.ts']);
});
test('verifica origen y destino de renames', () => {
  const f = fixture();
  renameSync(path.join(f.root, 'old name.ts'), path.join(f.root, 'renamed name.ts'));
  f.git('add', 'old name.ts', 'renamed name.ts');
  assert.deepEqual(f.evaluate().outside, ['old name.ts', 'renamed name.ts']);
});
test('CLI no convierte una base ausente en éxito', () => {
  const result = spawnSync(
    process.execPath,
    [
      path.join(import.meta.dirname, 'scope.mjs'),
      'plans/platform-calidad-integral/001-calidad-convenciones-y-harness.md',
      '--base',
      'fixture-base-absent',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /No se pudo/);
  assert.doesNotMatch(result.stdout, /✔/);
});
