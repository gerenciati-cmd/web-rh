import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, createTestSite, signInAs, signInAsEmployee } from './test-app';

/**
 * Alcance propio del colaborador (plan identity-acceso/007): una sesión creada por el flujo real
 * de invitación lleva `employeeId` y la concesión `attendance.workdays:read-own`, pero no abre
 * ninguna ruta de personal. Persistencia en memoria, como `invitations.test.ts`.
 */
describe('alcance propio del colaborador — HTTP', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let employeeToken: string;
  let companyA: string;
  let anaId: string;

  const as = (token: string) => ({
    get: (path: string) =>
      request(app).get(`${API_PREFIX}${path}`).set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      request(app).post(`${API_PREFIX}${path}`).set('Authorization', `Bearer ${token}`),
  });

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    const company = await as(adminToken)
      .post('/companies')
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyA = company.body.id as string;
    const hired = await as(adminToken)
      .post(`/companies/${companyA}/employees`)
      .send({
        siteId,
        nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
        rfc: 'GOMA850101AB1',
        firstName: 'Ana',
        lastName: 'Rojas',
        email: 'ana@aps.cl',
        hireDate: '2026-01-10',
      })
      .expect(201);
    anaId = hired.body.id as string;
    employeeToken = await signInAsEmployee(container, { companyId: companyA, employeeId: anaId });
  });

  it('signInAsEmployee: el actor lleva su employeeId y la concesión read-own de su empresa', async () => {
    const actor = await container.cradle.requestAuthenticator.authenticate(employeeToken);

    expect(actor?.employeeId).toBe(anaId);
    expect(actor?.grants).toEqual([
      { permission: 'attendance.workdays:read-own', companyId: companyA },
    ]);
    const me = await as(employeeToken).get('/auth/me').expect(200);
    expect(me.body).toMatchObject({ email: 'ana@aps.cl', employeeId: anaId });
  });

  it('el colaborador recibe 403 en la lista de colaboradores de su propia empresa', async () => {
    await as(employeeToken).get(`/companies/${companyA}/employees`).expect(403);
  });

  it('el colaborador recibe 403 en las jornadas de su propia empresa (ruta de personal)', async () => {
    await as(employeeToken)
      .get(
        `/companies/${companyA}/attendance/employees/${anaId}/workdays?from=2026-10-05&to=2026-10-11`,
      )
      .expect(403);
  });

  it('el colaborador no puede invitar ni listar empresas con permiso de personal', async () => {
    await as(employeeToken)
      .post(`/companies/${companyA}/employees/${anaId}/invitations`)
      .expect(403);
  });
});
