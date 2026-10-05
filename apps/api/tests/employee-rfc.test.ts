import { Email, NationalId } from '@rrhh/domain';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/** RFC de persona física del colaborador (plan employees-rfc/001): HTTP sobre persistencia en memoria. */
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000dead';

const mexican = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};
const otherMexican = {
  ...mexican,
  nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
  rfc: 'PEXL900215AB2',
  email: 'pedro@aps.example',
};
const dominican = {
  nationalId: { country: 'DO', number: '00113918205' },
  firstName: 'Luis',
  lastName: 'Araya',
  email: 'luis@aps.example',
  hireDate: '2026-01-10',
};

describe('RFC del colaborador (HTTP)', () => {
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
    call('post', `/companies/${companyId}/employees`, token).send({ siteId, ...body });
  const assign = (
    companyId: string,
    employeeId: string,
    body: object,
    token: string | null = adminToken,
  ) => call('put', `/companies/${companyId}/employees/${employeeId}/rfc`, token).send(body);
  const list = async (companyId: string) =>
    (await call('get', `/companies/${companyId}/employees`, adminToken).expect(200)).body.items as {
      id: string;
      rfc: string | null;
    }[];

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  /** Fila anterior al campo: el alta por la API ya exige RFC, así que se inserta como el dato viejo. */
  async function insertLegacyEmployee(companyId: string): Promise<string> {
    const nationalId = NationalId.create('MX', 'ROSA010305HQRDNLA3');
    const email = Email.create('legacy@aps.example');
    if (!nationalId.ok || !email.ok) throw new Error('fixture inválido');
    const id = '00000000-0000-4000-8000-0000000000a1' as EmployeeId;
    await container.cradle.employeeRepository.save(
      Employee.restore(id, {
        companyId,
        nationalId: nationalId.value,
        rfc: null,
        siteId: null,
        firstName: 'Luis',
        lastName: 'Antiguo',
        email: email.value,
        positionTitle: null,
        hireDate: new Date('2025-01-01T00:00:00Z'),
        status: 'ACTIVE',
      }),
    );
    return id;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container);
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
  });

  describe('POST /companies/:id/employees', () => {
    it('201 con RFC válido y el listado lo muestra normalizado en mayúsculas', async () => {
      await hire(companyA, { ...mexican, rfc: 'goma850101ab1' }).expect(201);

      expect((await list(companyA))[0]?.rfc).toBe('GOMA850101AB1');
    });

    it('400 sin RFC para un colaborador de México, con el error en rfc', async () => {
      const { rfc: _omitido, ...withoutRfc } = mexican;
      const response = await hire(companyA, withoutRfc).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.issues[0].path).toEqual(['rfc']);
    });

    it('400 con un RFC inválido', async () => {
      const response = await hire(companyA, { ...mexican, rfc: 'GOMA851301AB1' }).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.issues[0].path).toEqual(['rfc']);
    });

    it('409 EMPLOYEE_RFC_ALREADY_REGISTERED con un RFC usado en otra empresa del holding', async () => {
      await hire(companyA, mexican).expect(201);

      const response = await hire(companyB, { ...otherMexican, rfc: mexican.rfc }).expect(409);

      expect(response.body.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
      expect(await list(companyB)).toEqual([]);
    });

    it('409 EMPLOYEE_ALREADY_EXISTS (no el de RFC) con la misma CURP en la misma empresa', async () => {
      await hire(companyA, mexican).expect(201);

      const response = await hire(companyA, mexican).expect(409);

      expect(response.body.code).toBe('EMPLOYEE_ALREADY_EXISTS');
    });

    it('201 sin RFC para un colaborador dominicano y el listado muestra rfc null', async () => {
      await hire(companyA, dominican).expect(201);

      expect((await list(companyA))[0]?.rfc).toBeNull();
    });

    it('400 con RFC para un colaborador dominicano', async () => {
      const response = await hire(companyA, { ...dominican, rfc: 'GOMA850101AB1' }).expect(400);

      expect(response.body.details.issues[0].path).toEqual(['rfc']);
    });

    it('201 sin RFC para un colaborador colombiano', async () => {
      await hire(companyA, {
        ...dominican,
        nationalId: { country: 'CO', number: '1020304050' },
      }).expect(201);
    });
  });

  describe('PUT /companies/:companyId/employees/:employeeId/rfc', () => {
    it('204 como HR de la empresa y el listado muestra el RFC', async () => {
      const id = await insertLegacyEmployee(companyA);

      await assign(companyA, id, { rfc: 'rosa010305ab1' }, hrAToken).expect(204);

      expect((await list(companyA)).find((e) => e.id === id)?.rfc).toBe('ROSA010305AB1');
    });

    it('un colaborador anterior al campo (rfc null) sigue listándose y puede recibir su RFC', async () => {
      const id = await insertLegacyEmployee(companyA);
      expect((await list(companyA))[0]).toMatchObject({ id, rfc: null });

      await assign(companyA, id, { rfc: 'ROSA010305AB1' }).expect(204);

      expect((await list(companyA))[0]?.rfc).toBe('ROSA010305AB1');
    });

    it('204 al repetir el mismo RFC (idempotente)', async () => {
      await hire(companyA, mexican).expect(201);
      const [ana] = await list(companyA);

      await assign(companyA, ana?.id ?? '', { rfc: mexican.rfc }, hrAToken).expect(204);
      expect((await list(companyA))[0]?.rfc).toBe(mexican.rfc);
    });

    it('204 al corregir un RFC por otro libre', async () => {
      await hire(companyA, mexican).expect(201);
      const [ana] = await list(companyA);

      await assign(companyA, ana?.id ?? '', { rfc: 'GOMA850101AB9' }, hrAToken).expect(204);
      expect((await list(companyA))[0]?.rfc).toBe('GOMA850101AB9');
    });

    it('409 EMPLOYEE_RFC_ALREADY_REGISTERED si el RFC es de otro colaborador', async () => {
      await hire(companyA, mexican).expect(201);
      await hire(companyB, otherMexican).expect(201);
      const [pedro] = await list(companyB);

      const response = await assign(
        companyB,
        pedro?.id ?? '',
        { rfc: mexican.rfc },
        hrBToken,
      ).expect(409);

      expect(response.body.code).toBe('EMPLOYEE_RFC_ALREADY_REGISTERED');
      expect((await list(companyB))[0]?.rfc).toBe(otherMexican.rfc);
    });

    it('400 con un RFC inválido, con el error en rfc', async () => {
      const id = await insertLegacyEmployee(companyA);

      const response = await assign(companyA, id, { rfc: 'EKU9003173C9' }, hrAToken).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.issues[0].path).toEqual(['rfc']);
    });

    it('404 EMPLOYEE_NOT_FOUND para HOLDING_ADMIN con un id desconocido', async () => {
      const response = await assign(companyA, NO_EMPLOYEE, { rfc: mexican.rfc }).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('404 EMPLOYEE_NOT_FOUND para HOLDING_ADMIN si el colaborador es de otra empresa', async () => {
      await hire(companyB, mexican).expect(201);
      const [ana] = await list(companyB);

      const response = await assign(companyA, ana?.id ?? '', { rfc: 'GOMA850101AB9' }).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect((await list(companyB))[0]?.rfc).toBe(mexican.rfc);
    });

    it('403 FORBIDDEN para HR de otra empresa, sin tocar al colaborador', async () => {
      await hire(companyA, mexican).expect(201);
      const [ana] = await list(companyA);

      const response = await assign(
        companyA,
        ana?.id ?? '',
        { rfc: 'GOMA850101AB9' },
        hrBToken,
      ).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect((await list(companyA))[0]?.rfc).toBe(mexican.rfc);
    });

    it('422 RFC_NOT_APPLICABLE para un colaborador dominicano', async () => {
      await hire(companyA, dominican).expect(201);
      const [luis] = await list(companyA);

      const response = await assign(
        companyA,
        luis?.id ?? '',
        { rfc: mexican.rfc },
        hrAToken,
      ).expect(422);

      expect(response.body.code).toBe('RFC_NOT_APPLICABLE');
    });

    it('401 AUTHENTICATION_REQUIRED sin sesión', async () => {
      const response = await assign(companyA, NO_EMPLOYEE, { rfc: mexican.rfc }, null).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('OpenAPI', () => {
    it('GET /openapi.json documenta el PUT con employees:update', async () => {
      const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);

      const operation =
        response.body.paths['/companies/{companyId}/employees/{employeeId}/rfc'].put;
      expect(operation['x-permission']).toBe('employees:update');
    });
  });
});
