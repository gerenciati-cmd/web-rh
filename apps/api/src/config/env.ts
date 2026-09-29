import { existsSync } from 'node:fs';

import { z } from 'zod';

/**
 * Configuración validada al arrancar: si falta algo, el proceso falla de inmediato
 * con un mensaje claro (fail fast), en vez de explotar en runtime a mitad de un request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  // Números de serie de los equipos ZKTeco autorizados a empujar datos por ADMS. Vacío = ninguno.
  ZKTECO_ALLOWED_SERIALS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((serial) => serial.trim())
        .filter(Boolean),
    ),
  // Sesiones y login: valores de desarrollo (plan 001, README decisión 5).
  SESSION_WEB_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_WEB_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_MOBILE_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_BLOCK_MINUTES: z.coerce.number().int().positive().default(15),
  // Contraseña del usuario admin@example.com que crea `pnpm db:seed`; vacío = no se crea.
  SEED_USER_PASSWORD: z.string().min(12).optional(),
});

export type Env = z.output<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source === process.env && existsSync('.env')) process.loadEnvFile('.env');

  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Variables de entorno inválidas:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
