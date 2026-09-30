import { expect, it } from 'vitest';

import { apiRoutes, buildOpenApiDocument } from './index';

// `openapi.json` versionado: si cambia un contrato sin regenerarlo, este test falla en
// `pnpm check`. Regenerar: `pnpm --filter @rrhh/contracts openapi`.
it('openapi.json está al día con los contratos', async () => {
  const document = `${JSON.stringify(buildOpenApiDocument(apiRoutes), null, 2)}\n`;
  await expect(document).toMatchFileSnapshot('../openapi.json');
});
