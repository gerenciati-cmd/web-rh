import { pino, type Logger as PinoLogger } from 'pino';

import type { Env } from '@/config/env';

/** pino cumple estructuralmente el puerto `Logger`; aquí solo se configura. */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): PinoLogger {
  return pino({
    level: env.LOG_LEVEL,
    redact: {
      // Nunca loguear credenciales ni datos sensibles de colaboradores.
      paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
      censor: '[REDACTED]',
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss' } } }
      : {}),
  });
}
