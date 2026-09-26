import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { modules, type AppContainer } from '@/container';

import { errorHandler, notFoundHandler } from './error-handler';
import { createHealthRouter } from './health.router';

export const API_PREFIX = '/api/v1';

/** Fábrica de la app Express. Recibe el contenedor ya armado (testeable con dobles). */
export function createApp(container: AppContainer): Express {
  const { env, logger, healthChecks } = container.cradle;
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = req.headers['x-request-id']?.toString() ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );

  app.use('/health', createHealthRouter({ healthChecks }));

  const api = Router();
  for (const module of modules) {
    if (module.router) api.use(module.router(container.cradle));
  }
  app.use(API_PREFIX, api);

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
