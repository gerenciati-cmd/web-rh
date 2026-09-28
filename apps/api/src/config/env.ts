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
