import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { loadEnv } from '@/config/env';
import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, testEnv } from './test-app';

/**
 * Tests HTTP de la referencia OpenAPI/Scalar (plan platform-openapi/001, paso 3): montada fuera
 * de producción, antes del middleware de autenticación (`app.ts`), y ausente en producción.
 */
describe('documentación de la API (/openapi.json, /docs)', () => {
  it('GET /api/v1/openapi.json responde 200 con el documento OpenAPI, sin sesión', async () => {
    const app = createApp(buildTestContainer());

    const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);

    expect(response.body).toMatchObject({
      openapi: '3.1.0',
      info: { title: 'API RRHH APS Holding' },
    });
    expect(response.body.paths).toHaveProperty('/companies');
  });

  it('GET /api/v1/docs responde 200 con HTML, sin sesión', async () => {
    const app = createApp(buildTestContainer());

    const response = await request(app).get(`${API_PREFIX}/docs`).expect(200);

    expect(response.headers['content-type']).toMatch(/html/);
  });

  // Hallazgo 4 de la revisión (ronda de reparación 1): la CSP relajada de /docs es solo para esa
  // ruta, con un nonce por petición (no `'unsafe-inline'`), y no debe filtrarse al resto de la
  // API (`docs.router.ts:36-41`).
  it('la CSP de /docs permite el CDN de Scalar con un nonce que coincide con el <script> servido, sin upgrade-insecure-requests', async () => {
    const app = createApp(buildTestContainer());

    const response = await request(app).get(`${API_PREFIX}/docs`).expect(200);

    const csp = response.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).toMatch(/script-src[^;]*'self'/);
    expect(csp).toMatch(/script-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
    expect(csp).not.toMatch(/upgrade-insecure-requests/);

    const nonceMatch = /'nonce-([^']+)'/.exec(csp ?? '');
    expect(nonceMatch).not.toBeNull();
    const nonce = nonceMatch?.[1];
    expect(response.text).toContain(`nonce="${nonce}"`);
  });

  it('la CSP relajada de /docs no se filtra a otras rutas (mantienen el helmet() global)', async () => {
    const app = createApp(buildTestContainer());

    const response = await request(app).get(`${API_PREFIX}/companies`);

    const csp = response.headers['content-security-policy'];
    expect(csp).toBeDefined();
    expect(csp).not.toMatch(/cdn\.jsdelivr\.net/);
    expect(csp).not.toMatch(/'nonce-/);
  });

  it('con NODE_ENV=production, /api/v1/openapi.json responde 404', async () => {
    const productionEnv = loadEnv({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testEnv.DATABASE_URL,
    });
    const app = createApp(buildTestContainer(productionEnv));

    await request(app).get(`${API_PREFIX}/openapi.json`).expect(404);
  });

  it('con NODE_ENV=production, /api/v1/docs responde 404', async () => {
    const productionEnv = loadEnv({
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testEnv.DATABASE_URL,
    });
    const app = createApp(buildTestContainer(productionEnv));

    await request(app).get(`${API_PREFIX}/docs`).expect(404);
  });
});
