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

  // Hallazgo bajo 1 y hallazgo info 2 de la revisión (ronda de reparación 1 y 2): el bundle está
  // fijado a una versión exacta (`docs.router.ts:13`, `SCALAR_BUNDLE`), y la CSP permite
  // exactamente esa URL, no todo el host `cdn.jsdelivr.net` (que permitiría cualquier otro
  // paquete de npm en el origen de la API). Si `cdn` se cae al valor por defecto de Scalar
  // (`DEFAULT_CDN`, sin versión) o la CSP se ensancha a todo el host, este test lo detecta.
  it('el bundle de /docs está fijado a la versión pineada, y la CSP solo permite esa URL exacta (no todo cdn.jsdelivr.net)', async () => {
    const app = createApp(buildTestContainer());

    const response = await request(app).get(`${API_PREFIX}/docs`).expect(200);

    const pinnedBundle = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.2';
    // El bundle servido por Scalar (`html-rendering.js`: `<script src="${cdn ?? DEFAULT_CDN}">`).
    expect(response.text).toContain(`<script src="${pinnedBundle}"`);

    const csp = response.headers['content-security-policy'];
    const scriptSrcMatch = /script-src ([^;]+)/.exec(csp ?? '');
    const sources = (scriptSrcMatch?.[1] ?? '').split(' ');
    expect(sources).toContain(pinnedBundle);
    // El host solo, sin versión, no debe aparecer como fuente separada: eso habilitaría
    // cualquier paquete de jsdelivr, no solo el bundle fijado.
    expect(sources).not.toContain('https://cdn.jsdelivr.net');
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
