import { loadEnv } from '@/config/env';
import { buildContainer, wireSubscriptions } from '@/container';
import { API_PREFIX, createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';

const env = loadEnv();
const logger = createLogger(env);
const container = buildContainer(env, logger);
wireSubscriptions(container);

const server = createApp(container).listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}${API_PREFIX}`);
});

/** Apagado ordenado: deja de aceptar requests, termina los en curso y libera conexiones. */
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando API');
  server.close();
  await container.dispose();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
