import { Worker } from 'bullmq';

import { loadEnv } from '@/config/env';
import { buildContainer, modules, wireSubscriptions } from '@/container';
import { createLogger } from '@/infrastructure/logging/pino-logger';
import { DEFAULT_QUEUE } from '@/infrastructure/queue/bullmq-job-queue';
import type { JobHandler } from '@/shared/application/jobs';

/**
 * Worker: MISMO código y contenedor que el API, otro punto de entrada.
 * Ejecuta jobs pesados fuera del ciclo request/response. Se despliega como otro
 * contenedor con la misma imagen (`node dist/worker.js`) y escala por separado.
 */
const env = loadEnv();
const logger = createLogger(env);
const container = buildContainer(env, logger);
wireSubscriptions(container);

const handlers = new Map<string, JobHandler>();
for (const module of modules) {
  const moduleJobs = module.jobs?.(container.cradle) ?? [];
  for (const handler of moduleJobs) handlers.set(handler.name, handler);
}

const worker = new Worker(
  DEFAULT_QUEUE,
  async (job) => {
    const handler = handlers.get(job.name);
    if (!handler) throw new Error(`No hay handler registrado para el job "${job.name}"`);
    await handler.handle(job.data);
  },
  { connection: { url: env.REDIS_URL }, concurrency: 5 },
);

worker.on('ready', () => {
  logger.info({ queue: DEFAULT_QUEUE, jobs: [...handlers.keys()] }, 'worker listo');
});
worker.on('failed', (job, err) => {
  logger.error({ err, job: job?.name, jobId: job?.id }, 'job falló');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'apagando worker');
  await worker.close();
  await container.dispose();
  process.exit(0);
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
