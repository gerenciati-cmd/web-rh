import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, signInAs } from './test-app';

/** Catálogo de sedes (plan organization-sedes/001) sobre el contenedor real en memoria. */
describe('API HTTP: sedes', () => {
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrToken: string;

  beforeEach(async () => {
    const container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    // HR siempre va acotado a una empresa (role-assignment.ts:47-49).
    const company = await request(app)
      .post(`${API_PREFIX}/companies`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    hrToken = await signInAs(container, { role: 'HR', companyId: company.body.id as string });
  });

  const as = (token: string | null) => ({
    get: (path: string) => {
      const test = request(app).get(`${API_PREFIX}${path}`);
      return token ? test.set('Authorization', `Bearer ${token}`) : test;
    },
    post: (path: string) => {
      const test = request(app).post(`${API_PREFIX}${path}`);
      return token ? test.set('Authorization', `Bearer ${token}`) : test;
    },
  });

  const cancun = { name: 'Cancún Centro', country: 'MX', timeZone: 'America/Cancun' };

  it('HOLDING_ADMIN crea una sede (201 { id }) y aparece activa en el listado', async () => {
    const created = await as(adminToken).post('/sites').send(cancun).expect(201);
    expect(created.body.id).toEqual(expect.any(String));

    const list = await as(adminToken).get('/sites').expect(200);
    expect(list.body).toMatchObject({
      total: 1,
      items: [{ id: created.body.id, name: 'Cancún Centro', active: true, country: 'MX' }],
    });
  });

  it('el mismo nombre con otra capitalización es 409 SITE_ALREADY_EXISTS', async () => {
    await as(adminToken).post('/sites').send(cancun).expect(201);
    const response = await as(adminToken)
      .post('/sites')
      .send({ ...cancun, name: 'cancún centro' })
      .expect(409);
    expect(response.body.code).toBe('SITE_ALREADY_EXISTS');
  });

  it('zona de otro país es 400 en timeZone', async () => {
    const response = await as(adminToken)
      .post('/sites')
      .send({ ...cancun, timeZone: 'America/Bogota' })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.details.issues[0].path).toEqual(['timeZone']);
  });

  it('una zona inventada es 400', async () => {
    await as(adminToken)
      .post('/sites')
      .send({ ...cancun, timeZone: 'Mars/Olympus' })
      .expect(400);
  });

  it('una sede dominicana con su zona es 201', async () => {
    await as(adminToken)
      .post('/sites')
      .send({ name: 'Santo Domingo', country: 'DO', timeZone: 'America/Santo_Domingo' })
      .expect(201);
  });

  it('HR puede listar (200) pero no crear (403)', async () => {
    await as(hrToken).get('/sites').expect(200);
    const response = await as(hrToken).post('/sites').send(cancun).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('anónimo recibe 401 al listar y al crear', async () => {
    await as(null).get('/sites').expect(401);
    await as(null).post('/sites').send(cancun).expect(401);
  });

  it('la documentación OpenAPI publica las dos rutas', async () => {
    const docs = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);
    expect(docs.body.paths['/sites']).toHaveProperty('get');
    expect(docs.body.paths['/sites']).toHaveProperty('post');
  });
});
