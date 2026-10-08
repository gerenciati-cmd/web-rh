import { randomUUID } from 'node:crypto';

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';

import { modules, type AppContainer } from '@/container';

import { createAuthenticate } from './authenticate';
import { createDocsRouter } from './docs.router';
import { errorHandler, notFoundHandler } from './error-handler';
import { createHealthRouter } from './health.router';

export const API_PREFIX = '/api/v1';

/** Fábrica de la app Express. Recibe el contenedor ya armado (testeable con dobles). */
export function createApp(container: AppContainer): Express {
  const { env, logger, healthChecks } = container.cradle;
  const app = express();

  app.disable('x-powered-by');
  // `req.ip` debe ser la IP del cliente real detrás de un proxy (barrera de red de /iclock).
  app.set('trust proxy', env.TRUST_PROXY);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));
  // Los equipos sondean cada pocos segundos: sus peticiones exitosas van a debug.
  const quietPaths = new Set(modules.flatMap((module) => module.quietRequestPaths ?? []));
  app.use(
    pinoHttp({
      logger,
      customLogLevel: (req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        const path = req.url.split('?')[0] ?? '';
        return quietPaths.has(path) ? 'debug' : 'info';
      },
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

  // Antes del API autenticado: la referencia no necesita sesión. Nunca en producción (no se
  // publica el mapa de la API de RRHH).
  if (env.NODE_ENV !== 'production') {
    app.use(API_PREFIX, createDocsRouter({ openApiUrl: `${API_PREFIX}/openapi.json` }));
  }

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
