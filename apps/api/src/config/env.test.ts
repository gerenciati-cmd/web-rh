import { describe, expect, it } from 'vitest';

import { loadEnv } from './env';

const base = { DATABASE_URL: 'postgresql://test:test@localhost:5432/test' };

// Regresión H1 (plan 001, paso 15): `process.loadEnvFile` convierte una línea `SEED_USER_PASSWORD=`
// (como la que deja `.env.example`) en `""`, no en `undefined`; sin el preprocess de `env.ts`,
// `z.string().min(12).optional()` rechazaba esa cadena vacía y `loadEnv` lanzaba al arrancar.
describe('loadEnv — SEED_USER_PASSWORD (H1)', () => {
  it('trata la cadena vacía como ausente, en vez de rechazarla', () => {
    const env = loadEnv({ ...base, SEED_USER_PASSWORD: '' });

    expect(env.SEED_USER_PASSWORD).toBeUndefined();
  });

  it('queda ausente cuando la variable no aparece', () => {
    const env = loadEnv({ ...base });

    expect(env.SEED_USER_PASSWORD).toBeUndefined();
  });

  it('acepta una contraseña de al menos 12 caracteres', () => {
    const env = loadEnv({ ...base, SEED_USER_PASSWORD: 'contraseña12' });

    expect(env.SEED_USER_PASSWORD).toBe('contraseña12');
  });

  it('sigue rechazando una contraseña no vacía pero más corta que el mínimo', () => {
    expect(() => loadEnv({ ...base, SEED_USER_PASSWORD: 'corta' })).toThrow(
      /Variables de entorno inválidas/,
    );
  });
});
