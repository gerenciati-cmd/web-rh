/**
 * Reconstrucción de las bases LOCALES (`pnpm db:reset`): borra, recrea, migra y (en desarrollo)
 * siembra. Todas las comprobaciones de seguridad ocurren ANTES de borrar nada. Los efectos
 * (subprocesos, confirmación, log) llegan inyectados para poder testearlo sin Docker.
 */
const TEST_DATABASE = 'rrhh_test';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const COMPOSE_EXEC = [
  'compose',
  '-f',
  'infra/docker/docker-compose.yml',
  'exec',
  '-T',
  'postgres',
  'sh',
  '-eu',
  '-c',
];

// Rol y base se resuelven dentro del contenedor, igual que en bootstrap-database.mjs.
const psqlOn = (database) =>
  `exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${database} "$@"`;

// El nombre viaja como variable de psql (`:"db"` lo cita como identificador): nunca se
// concatena en SQL ni en texto de shell.
const RECREATE_SQL = 'DROP DATABASE IF EXISTS :"db" WITH (FORCE);\nCREATE DATABASE :"db";\n';

const QUIET = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };

/**
 * @param {{ target: 'dev' | 'test', seed: boolean }} options
 * @param {{
 *   run: typeof import('node:child_process').execFileSync,
 *   confirm: (expectedName: string) => Promise<boolean>,
 *   env: Record<string, string | undefined>,
 *   log: (line: string) => void,
 * }} deps
 */
export async function resetDatabase({ target, seed }, deps) {
  const { run, confirm, env, log } = deps;

  log(`\n▸ Reset de la base de ${target === 'dev' ? 'desarrollo' : 'test'}`);
  const name = target === 'dev' ? resolveDevDatabase(run) : TEST_DATABASE;
  const url = validatedUrl(target, name, env);

  if (target === 'dev' && !(await confirm(name))) throw new Error('Reset cancelado');

  recreate(run, name);
  log(`  + ${name} recreada`);

  const appEnv = { ...process.env, ...env, DATABASE_URL: url };
  run('pnpm', ['--filter', '@rrhh/api', 'db:deploy'], { stdio: 'inherit', env: appEnv });
  log('  + migraciones aplicadas');

  if (target === 'dev' && seed) {
    run('pnpm', ['--filter', '@rrhh/api', 'db:seed'], { stdio: 'inherit', env: appEnv });
    log('  + datos de ejemplo cargados');
  }
}

function resolveDevDatabase(run) {
  try {
    const name = run(
      'docker',
      [
        ...COMPOSE_EXEC,
        psqlOn('"$POSTGRES_DB"'),
        'database-reset',
        '-tAc',
        'SELECT current_database()',
      ],
      QUIET,
    ).trim();
    if (!name) throw new Error('vacío');
    return name;
  } catch {
    // El error del subproceso puede contener datos de conexión: no lo propagamos al log.
    throw new Error(
      'No se pudo resolver la base de desarrollo. ¿Está corriendo la infraestructura (pnpm db:up)?',
    );
  }
}

/** URL que usarán migrate y seed: debe ser local y apuntar exactamente a la base a borrar. */
function validatedUrl(target, name, env) {
  // Misma regla que tests/integration/test-database-url.ts: DATABASE_URL_TEST o, si falta,
  // DATABASE_URL con `_test` agregado al nombre de la base.
  const derivesTest = target === 'test' && !env.DATABASE_URL_TEST;
  const variable = target === 'test' && !derivesTest ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  const source = env[variable];
  if (!source) throw new Error(`Define ${variable} en apps/api/.env`);

  let url;
  try {
    url = new URL(source);
  } catch {
    throw new Error(`${variable} no es una URL válida`);
  }
  if (derivesTest) url.pathname = `${url.pathname}_test`;

  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`${variable} no apunta a localhost: db:reset solo opera sobre bases locales`);
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (database !== name) {
    throw new Error(`${variable} no apunta a la base "${name}" del contenedor`);
  }
  if (target === 'test' && !database.endsWith('_test')) {
    throw new Error(`Base de test inválida "${database}": debe terminar en _test`);
  }
  return url.toString();
}

function recreate(run, name) {
  try {
    run('docker', [...COMPOSE_EXEC, psqlOn('postgres'), 'database-reset', '-v', `db=${name}`], {
      ...QUIET,
      stdio: ['pipe', 'pipe', 'pipe'],
      input: RECREATE_SQL,
    });
  } catch {
    throw new Error(
      `No se pudo recrear ${name}. Revisa la configuración de PostgreSQL del contenedor.`,
    );
  }
}
