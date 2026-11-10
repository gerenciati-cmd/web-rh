import { createApiClient } from '@rrhh/api-client';

import { authFetch } from '@/features/identity/session/auth-fetch';
import { getCurrentToken } from '@/features/identity/session/session-store';

/**
 * Mismo cliente tipado que usa la web. Solo cambia de dónde sale la URL y el token: el token sale
 * de la sesión en memoria y `authFetch` avisa cuando el API lo rechaza.
 */
export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  getAccessToken: getCurrentToken,
  fetch: authFetch,
});
