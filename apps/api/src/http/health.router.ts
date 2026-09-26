import { Router } from 'express';

import type { HealthCheck } from '@/shared/application/ports';

/**
 *  /health/live  → el proceso responde (liveness: si falla, reiniciar el contenedor).
 *  /health/ready → dependencias OK (readiness: si falla, sacar del balanceador).
 */
export function createHealthRouter(deps: { healthChecks: HealthCheck[] }): Router {
  const router = Router();

  router.get('/live', (_req, res) => {
    res.json({ status: 'ok' });
  });

  router.get('/ready', async (_req, res) => {
    const results = await Promise.all(
      deps.healthChecks.map(async (check) => [check.name, await check.check()] as const),
    );
    const healthy = results.every(([, ok]) => ok);
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks: Object.fromEntries(results.map(([name, ok]) => [name, ok ? 'up' : 'down'])),
    });
  });

  return router;
}
