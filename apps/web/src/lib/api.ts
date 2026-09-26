import { createApiClient } from '@rrhh/api-client';

/**
 * Cliente del API para Server Components. Es el MISMO cliente tipado que usa mobile:
 * los tipos salen de @rrhh/contracts, así que un cambio de contrato rompe el build aquí.
 *
 * Regla: la web NO tiene lógica de negocio ni acceso a BD. Todo pasa por el API.
 */
export const api = createApiClient({
  baseUrl: process.env.API_URL ?? 'http://localhost:3001/api/v1',
  // TODO(identity): leer el token de la sesión (cookie httpOnly) cuando exista el módulo.
  getAccessToken: () => null,
});
