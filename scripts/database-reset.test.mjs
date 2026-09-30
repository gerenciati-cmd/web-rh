import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetDatabase } from './database-reset.mjs';

const RECREATE_SQL = 'DROP DATABASE IF EXISTS :"db" WITH (FORCE);\nCREATE DATABASE :"db";\n';

/**
 * Fake `run` (execFileSync-compatible) que registra cada llamada. Responde a la resolución del
 * nombre de la base de desarrollo (`SELECT current_database()`) con `devName`, y opcionalmente
 * lanza un error sintético cuando `failOn(command, args)` es verdadero — nunca detalle real, para
 * probar que el mensaje no se filtra (igual que `bootstrap-database.test.mjs`).
 */
function fakeRun({ devName = 'rrhh', failOn } = {}) {
  const calls = [];
  const run = (command, args, options) => {
    calls.push({ command, args, options });
    if (failOn?.(command, args)) throw new Error('detalle sensible sintético');
    if (args.includes('SELECT current_database()')) return `${devName}\n`;
    return '';
  };
  return { run, calls };
}

function fakeConfirm(result) {
  const calls = [];
  const confirm = async (expectedName) => {
    calls.push(expectedName);
    return result;
  };
  return { confirm, calls };
}

function fakeLog() {
  const lines = [];
  return { log: (line) => lines.push(line), lines };
}

const devEnv = { DATABASE_URL: 'postgres://localhost:5432/rrhh' };

test('dev con seed: orden resolver → confirmar → recrear → migrar → sembrar, con la URL validada', async () => {
  const { run, calls } = fakeRun();
  const { confirm, calls: confirmCalls } = fakeConfirm(true);
  const { log, lines } = fakeLog();

  await resetDatabase({ target: 'dev', seed: true }, { run, confirm, env: devEnv, log });

  assert.equal(calls.length, 4);
  assert.equal(calls[0].command, 'docker');
  assert.ok(calls[0].args.includes('SELECT current_database()'));
  assert.equal(calls[1].command, 'docker');
  assert.ok(calls[1].args.includes('-v'));
  assert.ok(calls[1].args.includes('db=rrhh'));
  assert.equal(calls[1].options.input, RECREATE_SQL);
  assert.deepEqual(calls[2].args, ['--filter', '@rrhh/api', 'db:deploy']);
  assert.equal(calls[2].command, 'pnpm');
  assert.equal(calls[2].options.env.DATABASE_URL, 'postgres://localhost:5432/rrhh');
  assert.deepEqual(calls[3].args, ['--filter', '@rrhh/api', 'db:seed']);
  assert.equal(calls[3].options.env.DATABASE_URL, 'postgres://localhost:5432/rrhh');

  assert.deepEqual(confirmCalls, ['rrhh']);
  assert.deepEqual(lines, [
    '\n▸ Reset de la base de desarrollo',
    '  + rrhh recreada',
    '  + migraciones aplicadas',
    '  + datos de ejemplo cargados',
  ]);
});

test('dev sin seed: no siembra', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(true);
  const { log, lines } = fakeLog();

  await resetDatabase({ target: 'dev', seed: false }, { run, confirm, env: devEnv, log });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2].args, ['--filter', '@rrhh/api', 'db:deploy']);
  assert.ok(!lines.some((line) => line.includes('sembrad')));
});

test('dev: confirmación negativa cancela antes de borrar nada', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(false);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase({ target: 'dev', seed: true }, { run, confirm, env: devEnv, log }),
    /Reset cancelado/,
  );
  // Solo se ejecutó la resolución de nombre (lectura); ningún DROP/CREATE ni migración.
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('SELECT current_database()'));
});

test('test: nunca pide confirmación, ignora --seed y usa el nombre literal rrhh_test', async () => {
  const { run, calls } = fakeRun();
  const { confirm, calls: confirmCalls } = fakeConfirm(true);
  const { log, lines } = fakeLog();

  await resetDatabase({ target: 'test', seed: true }, { run, confirm, env: devEnv, log });

  assert.equal(confirmCalls.length, 0);
  // Sin llamada de resolución (el nombre es el literal 'rrhh_test'): recrear es la primera.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].command, 'docker');
  assert.ok(calls[0].args.includes('db=rrhh_test'));
  assert.equal(calls[0].options.input, RECREATE_SQL);
  assert.equal(calls[1].command, 'pnpm');
  assert.deepEqual(calls[1].args, ['--filter', '@rrhh/api', 'db:deploy']);
  assert.equal(calls[1].options.env.DATABASE_URL, 'postgres://localhost:5432/rrhh_test');
  assert.ok(!lines.some((line) => line.includes('sembrad')));
});

test('test: usa DATABASE_URL_TEST directamente cuando está definida, en vez de derivarla', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();
  const env = {
    DATABASE_URL: 'postgres://localhost:5432/otra',
    DATABASE_URL_TEST: 'postgres://localhost:5432/rrhh_test',
  };

  await resetDatabase({ target: 'test', seed: false }, { run, confirm, env, log });

  assert.equal(calls[0].options.input, RECREATE_SQL);
  assert.ok(calls[0].args.includes('db=rrhh_test'));
  assert.equal(calls[1].options.env.DATABASE_URL, 'postgres://localhost:5432/rrhh_test');
});

test('rechaza antes de borrar si falta la variable de entorno', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase({ target: 'dev', seed: true }, { run, confirm, env: {}, log }),
    /Define DATABASE_URL en apps\/api\/\.env/,
  );
  // La única llamada fue la resolución (lectura); ningún DROP/CREATE.
  assert.equal(calls.length, 1);
});

test('rechaza una URL mal formada sin filtrar su contenido', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase(
      { target: 'dev', seed: true },
      { run, confirm, env: { DATABASE_URL: 'no-es-una-url' }, log },
    ),
    /DATABASE_URL no es una URL válida/,
  );
  assert.equal(calls.length, 1);
});

test('rechaza un host remoto sin filtrar el host en el mensaje', async () => {
  const { run, calls } = fakeRun();
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();
  const remoteUrl = 'postgres://prod.interno.example.com:5432/rrhh';

  await assert.rejects(
    resetDatabase(
      { target: 'dev', seed: true },
      { run, confirm, env: { DATABASE_URL: remoteUrl }, log },
    ),
    (error) => {
      assert.match(error.message, /DATABASE_URL no apunta a localhost/);
      assert.doesNotMatch(error.message, /prod\.interno\.example\.com/);
      return true;
    },
  );
  assert.equal(calls.length, 1);
});

test('rechaza si la base de la URL no coincide con la resuelta en el contenedor', async () => {
  const { run, calls } = fakeRun({ devName: 'rrhh' });
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase(
      { target: 'dev', seed: true },
      { run, confirm, env: { DATABASE_URL: 'postgres://localhost:5432/otra' }, log },
    ),
    /DATABASE_URL no apunta a la base "rrhh" del contenedor/,
  );
  assert.equal(calls.length, 1);
});

test('si falla la resolución del nombre, no confirma ni borra, y no filtra el detalle', async () => {
  const { run, calls } = fakeRun({
    failOn: (_command, args) => args.includes('SELECT current_database()'),
  });
  const { confirm, calls: confirmCalls } = fakeConfirm(true);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase({ target: 'dev', seed: true }, { run, confirm, env: devEnv, log }),
    (error) => {
      assert.match(error.message, /No se pudo resolver la base de desarrollo/);
      assert.doesNotMatch(error.message, /detalle sensible/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  assert.equal(confirmCalls.length, 0);
  assert.equal(calls.length, 1);
});

test('si falla el borrado/recreación, no migra ni siembra, y no filtra el detalle', async () => {
  const { run, calls } = fakeRun({
    failOn: (_command, args) => args.includes('db=rrhh'),
  });
  const { confirm } = fakeConfirm(true);
  const { log } = fakeLog();

  await assert.rejects(
    resetDatabase({ target: 'dev', seed: true }, { run, confirm, env: devEnv, log }),
    (error) => {
      assert.match(error.message, /No se pudo recrear rrhh/);
      assert.doesNotMatch(error.message, /detalle sensible/);
      assert.equal(error.cause, undefined);
      return true;
    },
  );
  // Se resolvió el nombre y se intentó recrear; nunca se llegó a migrar.
  assert.equal(calls.length, 2);
});
