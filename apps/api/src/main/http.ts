import { loadEnv } from '@/config/env';
import { buildContainer, wireSubscriptions } from '@/container';
import { API_PREFIX, createApp } from '@/http/app';
import { createLogger } from '@/infrastructure/logging/pino-logger';

import { createHttpShutdown } from './http-shutdown';

const env = loadEnv();
const logger = createLogger(env);
const container = buildContainer(env, logger);
wireSubscriptions(container);

const server = createApp(container).listen(env.PORT, () => {
  logger.info(`API escuchando en http://localhost:${env.PORT}${API_PREFIX}`);
});

const shutdown = createHttpShutdown({
  server,
  dispose: () => container.dispose(),
  logger,
  exit: (code) => process.exit(code),
});

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
