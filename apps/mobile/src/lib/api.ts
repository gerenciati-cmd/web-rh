import { createApiClient } from '@rrhh/api-client';

/**
 * Mismo cliente tipado que usa la web. Solo cambia de dónde sale la URL y el token.
 * TODO(identity): leer el access token desde expo-secure-store.
 */
export const api = createApiClient({
  baseUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1',
  getAccessToken: () => null,
});
