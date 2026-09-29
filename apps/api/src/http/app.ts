import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { modules, type AppContainer } from '@/container';

import { createAuthenticate } from './authenticate';
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

  // Antes del parser JSON: los equipos leen su body como texto sea cual sea el Content-Type.
  for (const module of modules) {
    if (module.deviceRouter) app.use(module.deviceRouter(container.cradle));
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/health', createHealthRouter({ healthChecks }));

  const api = Router();
  for (const module of modules) {
    if (module.router) api.use(module.router(container.cradle));
  }
  app.use(
    API_PREFIX,
    createAuthenticate({
      requestAuthenticator: container.cradle.requestAuthenticator,
      allowedOrigins: env.CORS_ORIGINS,
    }),
    api,
  );

  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}
