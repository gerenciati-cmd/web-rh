import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { FixedClock } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Baja de colaboradores (plan employees-desvinculacion/001): HTTP sobre persistencia en memoria.
 * El reloj se fija en 2026-03-01T12:00Z para que "hoy" y "mañana" sean deterministas.
 */
const TODAY = '2026-03-01';
const TOMORROW = '2026-03-02';
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000dead';

const mexican = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};

interface ListedEmployee {
  id: string;
  status: string;
  terminationDate: string | null;
  terminationReason: string | null;
}

describe('Baja del colaborador (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrAToken: string;
  let hrBToken: string;
  let companyA: string;
  let companyB: string;
  let employeeId: string;

  const call = (method: 'get' | 'post', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const terminate = (
    body: object,
    token: string | null = adminToken,
    companyId = companyA,
    id = employeeId,
  ) => call('post', `/companies/${companyId}/employees/${id}/termination`, token).send(body);
  const listed = async (companyId = companyA): Promise<ListedEmployee[]> =>
    (await call('get', `/companies/${companyId}/employees`, adminToken).expect(200)).body
      .items as ListedEmployee[];

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    container.register({ clock: asValue(new FixedClock(new Date(`${TODAY}T12:00:00Z`))) });
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container, 'Cancún Centro');
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
    const hired = await call('post', `/companies/${companyA}/employees`, adminToken)
      .send({ ...mexican, siteId })
      .expect(201);
    employeeId = hired.body.id as string;
  });

  it('204 y el directorio muestra al colaborador TERMINATED con fecha y motivo', async () => {
    const response = await terminate({ terminationDate: '2026-02-15', reason: 'DEATH' }).expect(
      204,
    );

    expect(response.body).toEqual({});
    expect(await listed()).toEqual([
      expect.objectContaining({
        id: employeeId,
        status: 'TERMINATED',
        terminationDate: '2026-02-15',
        terminationReason: 'DEATH',
      }),
    ]);
  });

  it('un colaborador activo aparece con fecha y motivo de baja null', async () => {
    expect(await listed()).toEqual([
      expect.objectContaining({ status: 'ACTIVE', terminationDate: null, terminationReason: null }),
    ]);
  });

  it('204 con la fecha de hoy', async () => {
    await terminate({ terminationDate: TODAY, reason: 'END_OF_CONTRACT' }).expect(204);
  });

  it('422 EMPLOYEE_ALREADY_TERMINATED en la segunda baja, sin cambiar la primera', async () => {
    await terminate({ terminationDate: '2026-02-15', reason: 'DEATH' }).expect(204);

    const response = await terminate({ terminationDate: TODAY, reason: 'OTHER' }).expect(422);

    expect(response.body).toEqual({
      code: 'EMPLOYEE_ALREADY_TERMINATED',
      message: 'El colaborador ya está desvinculado',
      details: { employeeId },
    });
    expect((await listed())[0]).toMatchObject({
      terminationDate: '2026-02-15',
      terminationReason: 'DEATH',
    });
  });

  it('422 TERMINATION_DATE_IN_FUTURE con la fecha de mañana, sin dar de baja', async () => {
    const response = await terminate({ terminationDate: TOMORROW, reason: 'OTHER' }).expect(422);

    expect(response.body).toEqual({
      code: 'TERMINATION_DATE_IN_FUTURE',
      message: 'La fecha de baja no puede ser posterior a hoy',
    });
    expect((await listed())[0]?.status).toBe('ACTIVE');
  });

  it('422 TERMINATION_BEFORE_HIRE con la fecha de contratación en details', async () => {
    const response = await terminate({ terminationDate: '2026-01-09', reason: 'OTHER' }).expect(
      422,
    );

    expect(response.body).toEqual({
      code: 'TERMINATION_BEFORE_HIRE',
      message: 'La fecha de baja es anterior a la contratación',
      details: { hireDate: '2026-01-10' },
    });
  });

  it('400 VALIDATION_ERROR con un motivo fuera del catálogo, con el error en reason', async () => {
    const response = await terminate({ terminationDate: TODAY, reason: 'RESIGNATION' }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
    expect(response.body.details.issues[0].path).toEqual(['reason']);
  });

  it('400 VALIDATION_ERROR sin fecha o con fecha mal formada', async () => {
    await terminate({ reason: 'OTHER' }).expect(400);
    const response = await terminate({ terminationDate: '01/03/2026', reason: 'OTHER' }).expect(
      400,
    );

    expect(response.body.details.issues[0].path).toEqual(['terminationDate']);
    expect((await listed())[0]?.status).toBe('ACTIVE');
  });

  it('404 EMPLOYEE_NOT_FOUND con un colaborador desconocido', async () => {
    const response = await terminate(
      { terminationDate: TODAY, reason: 'OTHER' },
      adminToken,
      companyA,
      NO_EMPLOYEE,
    ).expect(404);

    expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
  });

  it('404 EMPLOYEE_NOT_FOUND si el colaborador es de otra empresa (mismo cuerpo que inexistente)', async () => {
    const foreign = await terminate(
      { terminationDate: TODAY, reason: 'OTHER' },
      adminToken,
      companyB,
    ).expect(404);

    expect(foreign.body).toEqual({
      code: 'EMPLOYEE_NOT_FOUND',
      message: 'El colaborador no existe',
      details: { employeeId },
    });
    expect((await listed())[0]?.status).toBe('ACTIVE');
  });

  it('RH de la empresa del colaborador puede darlo de baja', async () => {
    await terminate({ terminationDate: TODAY, reason: 'OTHER' }, hrAToken).expect(204);
  });

  it('403 para RH de otra empresa, sin dar de baja', async () => {
    const response = await terminate({ terminationDate: TODAY, reason: 'OTHER' }, hrBToken).expect(
      403,
    );

    expect(response.body.code).toBe('FORBIDDEN');
    expect((await listed())[0]?.status).toBe('ACTIVE');
  });

  it('401 sin sesión', async () => {
    const response = await terminate({ terminationDate: TODAY, reason: 'OTHER' }, null).expect(401);

    expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
