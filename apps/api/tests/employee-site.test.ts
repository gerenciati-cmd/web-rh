import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { Site, type SiteId } from '@/modules/organization/domain/site';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/** Sede del colaborador (plan employees-sede/001): HTTP sobre persistencia en memoria. */
const NO_SITE = '00000000-0000-4000-8000-00000000d00d';
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000dead';

const mexican = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};

describe('Sede del colaborador (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrAToken: string;
  let hrBToken: string;
  let companyA: string;
  let companyB: string;
  let siteId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const hire = (companyId: string, body: object, token = adminToken) =>
    call('post', `/companies/${companyId}/employees`, token).send(body);
  const assign = (
    companyId: string,
    employeeId: string,
    body: object,
    token: string | null = adminToken,
  ) => call('put', `/companies/${companyId}/employees/${employeeId}/site`, token).send(body);
  const list = async (companyId: string) =>
    (await call('get', `/companies/${companyId}/employees`, adminToken).expect(200)).body.items as {
      id: string;
      siteId: string | null;
    }[];

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  /** Sede de otro país, para ejercitar SITE_COUNTRY_MISMATCH contra una razón social de México. */
  async function createDominicanSite(): Promise<string> {
    const created = await container.cradle.createSite.execute({
      name: 'Santo Domingo',
      country: 'DO',
      timeZone: 'America/Santo_Domingo',
    });
    if (!created.ok) throw created.error;
    return created.value.id;
  }

  /** Sede MX ya desactivada: no hay endpoint para desactivar, se rehidrata inactiva en el repositorio. */
  async function createInactiveSite(): Promise<string> {
    const id = '00000000-0000-4000-8000-0000000000b1' as SiteId;
    await container.cradle.siteRepository.save(
      Site.restore(id, {
        name: 'Sede cerrada',
        country: 'MX',
        timeZone: 'America/Cancun',
        active: false,
        createdAt: new Date('2025-01-01T00:00:00Z'),
      }),
    );
    return id;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container, 'Cancún Centro');
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
  });

  describe('POST /companies/:id/employees', () => {
    it('201 con una sede activa y el listado muestra el siteId', async () => {
      await hire(companyA, { ...mexican, siteId }).expect(201);

      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('400 sin siteId, con el error en siteId', async () => {
      const response = await hire(companyA, mexican).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.issues[0].path).toEqual(['siteId']);
    });

    it('404 SITE_NOT_FOUND con una sede desconocida, sin crear al colaborador', async () => {
      const response = await hire(companyA, { ...mexican, siteId: NO_SITE }).expect(404);

      expect(response.body.code).toBe('SITE_NOT_FOUND');
      expect(await list(companyA)).toEqual([]);
    });

    it('422 SITE_INACTIVE con una sede inactiva', async () => {
      const inactive = await createInactiveSite();

      const response = await hire(companyA, { ...mexican, siteId: inactive }).expect(422);

      expect(response.body.code).toBe('SITE_INACTIVE');
      expect(await list(companyA)).toEqual([]);
    });

    it('422 SITE_COUNTRY_MISMATCH con una sede de otro país que la razón social', async () => {
      const dominican = await createDominicanSite();

      const response = await hire(companyA, { ...mexican, siteId: dominican }).expect(422);

      expect(response.body.code).toBe('SITE_COUNTRY_MISMATCH');
      expect(await list(companyA)).toEqual([]);
    });
  });

  describe('PUT /companies/:companyId/employees/:employeeId/site', () => {
    const hireAna = async () => {
      await hire(companyA, { ...mexican, siteId }).expect(201);
      return (await list(companyA))[0]?.id ?? '';
    };

    it('204 como HR de la empresa y el listado muestra la sede nueva', async () => {
      const id = await hireAna();
      const other = await createTestSite(container, 'Mérida Norte');

      await assign(companyA, id, { siteId: other }, hrAToken).expect(204);

      expect((await list(companyA))[0]?.siteId).toBe(other);
    });

    it('204 al repetir la misma sede (idempotente)', async () => {
      const id = await hireAna();

      await assign(companyA, id, { siteId }, hrAToken).expect(204);

      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('un colaborador anterior al campo lista siteId null y puede recibir sede', async () => {
      const id = await hireAna();
      const stored = container.cradle.employeeRepository;
      const employee = await stored.findById(id as EmployeeId);
      if (!employee) throw new Error('fixture inválido');
      await stored.save(Employee.restore(employee.id, { ...employee.snapshot, siteId: null }));
      expect((await list(companyA))[0]).toMatchObject({ id, siteId: null });

      await assign(companyA, id, { siteId }).expect(204);

      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('400 con un siteId que no es uuid, con el error en siteId', async () => {
      const id = await hireAna();

      const response = await assign(companyA, id, { siteId: 'x' }, hrAToken).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.issues[0].path).toEqual(['siteId']);
    });

    it('404 SITE_NOT_FOUND con una sede desconocida, sin tocar al colaborador', async () => {
      const id = await hireAna();

      const response = await assign(companyA, id, { siteId: NO_SITE }, hrAToken).expect(404);

      expect(response.body.code).toBe('SITE_NOT_FOUND');
      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('422 SITE_INACTIVE con una sede inactiva', async () => {
      const id = await hireAna();
      const inactive = await createInactiveSite();

      const response = await assign(companyA, id, { siteId: inactive }, hrAToken).expect(422);

      expect(response.body.code).toBe('SITE_INACTIVE');
      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('422 SITE_COUNTRY_MISMATCH con una sede dominicana para una razón social de México', async () => {
      const id = await hireAna();
      const dominican = await createDominicanSite();

      const response = await assign(companyA, id, { siteId: dominican }, hrAToken).expect(422);

      expect(response.body.code).toBe('SITE_COUNTRY_MISMATCH');
      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('404 EMPLOYEE_NOT_FOUND para HOLDING_ADMIN con un id desconocido', async () => {
      const response = await assign(companyA, NO_EMPLOYEE, { siteId }).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('404 EMPLOYEE_NOT_FOUND para HOLDING_ADMIN si el colaborador es de otra empresa', async () => {
      await hire(companyB, { ...mexican, siteId }).expect(201);
      const [ana] = await list(companyB);
      const other = await createTestSite(container, 'Mérida Norte');

      const response = await assign(companyA, ana?.id ?? '', { siteId: other }).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect((await list(companyB))[0]?.siteId).toBe(siteId);
    });

    it('403 FORBIDDEN para HR de otra empresa, sin tocar al colaborador', async () => {
      const id = await hireAna();
      const other = await createTestSite(container, 'Mérida Norte');

      const response = await assign(companyA, id, { siteId: other }, hrBToken).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect((await list(companyA))[0]?.siteId).toBe(siteId);
    });

    it('401 AUTHENTICATION_REQUIRED sin sesión', async () => {
      const response = await assign(companyA, NO_EMPLOYEE, { siteId }, null).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('OpenAPI', () => {
    it('GET /openapi.json documenta el PUT de sede con employees:update', async () => {
      const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);

      const operation =
        response.body.paths['/companies/{companyId}/employees/{employeeId}/site'].put;
      expect(operation['x-permission']).toBe('employees:update');
    });
  });
});
