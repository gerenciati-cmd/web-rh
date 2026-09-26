import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { ensureTestDatabase } from './bootstrap-database.mjs';

test('no crea la base si ya existe', () => {
  let calls = 0;
  assert.equal(
    ensureTestDatabase(() => {
      calls++;
      return '1\n';
    }),
    false,
  );
  assert.equal(calls, 1);
});

test('crea la base ausente y permite repetir la preparación', () => {
  let exists = false;
  let creations = 0;
  const run = (_command, args) => {
    if (args.at(-1) === 'CREATE DATABASE rrhh_test') {
      exists = true;
      creations++;
      return 'CREATE DATABASE\n';
    }
    return exists ? '1\n' : '';
  };
  assert.equal(ensureTestDatabase(run), true);
  assert.equal(ensureTestDatabase(run), false);
  assert.equal(creations, 1);
});

for (const failAt of [1, 2]) {
  test(`detiene la preparación si falla la operación ${failAt} sin filtrar detalles`, () => {
    let calls = 0;
    assert.throws(
      () =>
        ensureTestDatabase(() => {
          calls++;
          if (calls === failAt) throw new Error('detalle sensible sintético');
          return '';
        }),
      (error) => {
        assert.match(error.message, /No se pudo preparar rrhh_test/);
        assert.doesNotMatch(error.message, /detalle sensible/);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(calls, failAt);
  });
}

for (const [role, database] of [
  ['rrhh', 'rrhh'],
  ['rol con espacios;$(false)', 'base "personalizada"'],
]) {
  test(`resuelve role y base dentro del contenedor como argumentos literales: ${role}`, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'rrhh-bootstrap-test-'));
    const capture = path.join(dir, 'args.json');
    try {
      writeFileSync(
        path.join(dir, 'psql'),
        `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\nconsole.log('1');\n`,
        { mode: 0o700 },
      );
      const result = ensureTestDatabase((command, args, options) => {
        assert.equal(command, 'docker');
        assert.deepEqual(args.slice(0, 6), [
          'compose',
          '-f',
          'infra/docker/docker-compose.yml',
          'exec',
          '-T',
          'postgres',
        ]);
        // Ejecutamos únicamente el shell del contenedor con un psql de prueba, sin Docker ni BD.
        return execFileSync(args[6], args.slice(7), {
          ...options,
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            CAPTURE: capture,
            POSTGRES_USER: role,
            POSTGRES_DB: database,
          },
        });
      });
      assert.equal(result, false);
      const args = JSON.parse(readFileSync(capture, 'utf8'));
      assert.equal(args[args.indexOf('-U') + 1], role);
      assert.equal(args[args.indexOf('-d') + 1], database);
      assert.ok(args.includes('-X'));
      assert.ok(args.includes('ON_ERROR_STOP=1'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
