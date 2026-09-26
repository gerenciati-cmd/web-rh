import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX } from '@/http/app';

import { buildTestApp } from './test-app';

/**
 * Tests de integración del adaptador HTTP: contrato → validación → caso de uso →
 * mapeo de errores. La persistencia es en memoria (rápido, sin Docker).
 */
describe('API HTTP', () => {
  let app: ReturnType<typeof buildTestApp>;

  beforeEach(() => {
    app = buildTestApp();
  });

  const createCompany = (body: object) => request(app).post(`${API_PREFIX}/companies`).send(body);

  const validCompany = { legalName: 'APS Holding SpA', taxId: '76.086.428-5', country: 'CL' };

  it('GET /health/live responde ok', async () => {
    await request(app).get('/health/live').expect(200, { status: 'ok' });
  });

  it('crea y lista empresas', async () => {
    const created = await createCompany(validCompany).expect(201);
    expect(created.body.id).toEqual(expect.any(String));

    const list = await request(app).get(`${API_PREFIX}/companies`).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ taxId: '76.086.428-5' }] });
  });

  it('400 con detalle por campo si el body no cumple el contrato', async () => {
    const response = await createCompany({ ...validCompany, taxId: '1-2' }).expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.details.issues[0].path).toEqual(['taxId']);
  });

  it('409 si la empresa ya existe', async () => {
    await createCompany(validCompany).expect(201);
    const response = await createCompany(validCompany).expect(409);
    expect(response.body.code).toBe('COMPANY_ALREADY_EXISTS');
  });

  it('404 con code estable para empresa inexistente', async () => {
    const response = await request(app)
      .get(`${API_PREFIX}/companies/00000000-0000-4000-8000-000000000000`)
      .expect(404);
    expect(response.body.code).toBe('COMPANY_NOT_FOUND');
  });

  it('registra un colaborador pasando por el módulo organization', async () => {
    const { body } = await createCompany(validCompany).expect(201);

    await request(app)
      .post(`${API_PREFIX}/companies/${body.id}/employees`)
      .send({
        nationalId: { country: 'CL', number: '12.345.678-5' },
        firstName: 'Ana',
        lastName: 'Rojas',
        email: 'ana@aps.cl',
        hireDate: '2026-01-10',
      })
      .expect(201);

    const list = await request(app).get(`${API_PREFIX}/companies/${body.id}/employees`).expect(200);
    expect(list.body.items[0]).toMatchObject({ fullName: 'Ana Rojas', nationalId: '12.345.678-5' });
  });
});
