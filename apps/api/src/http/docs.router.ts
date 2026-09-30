import { randomBytes } from 'node:crypto';

import { apiRoutes, buildOpenApiDocument } from '@rrhh/contracts';
import { apiReference } from '@scalar/express-api-reference';
import { Router } from 'express';
import { contentSecurityPolicy } from 'helmet';

/**
 * Bundle fijado: sin versión, el CDN serviría la última publicada en cada carga. 1.72.2 es la que
 * se verificó renderizando sin errores de CSP; subirla es un cambio deliberado. La CSP permite
 * exactamente esta URL, no todo el CDN.
 */
const SCALAR_BUNDLE = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.2';

/**
 *  /openapi.json → documento OpenAPI derivado de los contratos (el mismo que `openapi.json`).
 *  /docs         → referencia interactiva Scalar. Solo se monta fuera de producción.
 *
 * La CSP global de helmet (`script-src 'self'`) bloquearía el bundle del CDN y el script de
 * arranque en línea; aquí se relaja SOLO para esta página, con un nonce por petición en vez de
 * `'unsafe-inline'`.
 */
export function createDocsRouter(deps: { openApiUrl: string }): Router {
  const router = Router();
  const document = buildOpenApiDocument(apiRoutes);

  router.get('/openapi.json', (_req, res) => {
    res.json(document);
  });

  // Genéricos alineados con el `RequestHandler<never, string>` que devuelve Scalar.
  router.get<never, string>('/docs', (req, res, next) => {
    const nonce = randomBytes(16).toString('base64');
    const csp = contentSecurityPolicy({
      directives: {
        scriptSrc: ["'self'", SCALAR_BUNDLE, `'nonce-${nonce}'`],
        // En http://localhost reescribiría a https las peticiones de "probar" hacia el API.
        upgradeInsecureRequests: null,
      },
    });
    csp(req, res, (error?: unknown) => {
      if (error) {
        next(error);
        return;
      }
      apiReference({ url: deps.openApiUrl, nonce, cdn: SCALAR_BUNDLE })(req, res, next);
    });
  });

  return router;
}
