import { execFileSync } from 'node:child_process';

// La configuración se resuelve dentro del contenedor, igual que al iniciar Postgres.
const psql = 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"';

export function ensureTestDatabase(run = execFileSync) {
  const args = [
    'compose',
    '-f',
    'infra/docker/docker-compose.yml',
    'exec',
    '-T',
    'postgres',
    'sh',
    '-eu',
    '-c',
    psql,
    'bootstrap-database',
  ];
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] };
  try {
    const exists = run(
      'docker',
      [...args, '-tAc', "SELECT 1 FROM pg_database WHERE datname='rrhh_test'"],
      options,
    ).trim();
    if (exists === '1') return false;
    run('docker', [...args, '-c', 'CREATE DATABASE rrhh_test'], options);
    return true;
  } catch {
    // El error del subproceso puede contener datos de conexión: no lo propagamos al log.
    throw new Error(
      'No se pudo preparar rrhh_test. Revisa la configuración de PostgreSQL del contenedor.',
    );
  }
}
