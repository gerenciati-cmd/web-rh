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
  // Proxies de confianza para Express (`trust proxy`): la barrera de red de los checadores y el
  // throttle de login leen `req.ip`. Vacío = ninguno (se usa la IP del socket); un entero = saltos;
  // si no, lista de IPs/CIDR separadas por coma. Un valor demasiado amplio deja que un cliente
  // falsee su IP con `X-Forwarded-For`.
  TRUST_PROXY: z
    .string()
    .default('')
    .transform((value): boolean | number | string[] => {
      const trimmed = value.trim();
      if (trimmed === '') return false;
      if (/^\d+$/.test(trimmed)) return Number(trimmed);
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    }),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url().default('redis://localhost:6379'),
  // Sesiones y login: valores de desarrollo (plan 001, README decisión 5).
  SESSION_WEB_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_WEB_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  SESSION_MOBILE_ABSOLUTE_DAYS: z.coerce.number().int().positive().default(30),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  // Límite del throttle por IP, aparte del de correo (M2): una oficina o un reverse proxy
  // detrás de una sola IP no debe bloquear el login de toda la plataforma con 5 intentos.
  LOGIN_IP_MAX_FAILURES: z.coerce.number().int().positive().default(50),
  LOGIN_FAILURE_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
  LOGIN_BLOCK_MINUTES: z.coerce.number().int().positive().default(15),
  // Correo saliente (plan 003). En desarrollo: Mailpit en localhost:1025 (ver docker-compose).
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Vacío = sin autenticación (Mailpit). `loadEnvFile` convierte una línea vacía en `""`.
  SMTP_USER: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  SMTP_PASSWORD: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  MAIL_FROM: z.string().min(1).default('RRHH APS <no-reply@example.com>'),
  // Base de los enlaces de los correos (p. ej. `${APP_PUBLIC_URL}/activar?token=…`).
  APP_PUBLIC_URL: z.url().default('http://localhost:3000'),
  // Vigencia de una invitación (168 h = 7 días).
  INVITATION_TTL_HOURS: z.coerce.number().int().positive().default(168),
  // Vigencia del enlace de restablecer contraseña (60 min = 1 hora).
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(60),
  // Espera mínima entre dos solicitudes públicas de "olvidé mi contraseña" del mismo usuario.
  PASSWORD_RESET_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(180),
  // Contraseña del usuario admin@example.com que crea `pnpm db:seed`; vacío = no se crea.
  // `process.loadEnvFile` convierte `SEED_USER_PASSWORD=` (línea vacía en .env) en `""`, no en
  // `undefined`, así que sin este preprocess un .env recién copiado de .env.example no arranca.
  SEED_USER_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(12).optional(),
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
