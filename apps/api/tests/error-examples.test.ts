import { API_ERRORS, type ApiErrorCode } from '@rrhh/contracts';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, signInAs } from './test-app';

/**
 * Plan platform-openapi/002, criterio de aceptación "cada ejemplo coincide con lo que devuelve el
 * API": se provoca cada error contra el contenedor real en memoria y se compara con el ejemplo de
 * `API_ERRORS` (status, code, message y FORMA de `details`; los valores de `details` son sintéticos
 * en el ejemplo, así que solo se comparan sus claves).
 */
describe('Los ejemplos de API_ERRORS coinciden con las respuestas reales', () => {
  let app: ReturnType<typeof createApp>;
  let container: ReturnType<typeof buildTestContainer>;
  let adminToken: string;
  let hrToken: string;
  let companyId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };

  /** Compara una respuesta real contra el ejemplo documentado de `code`. */
  const expectMatchesExample = (
    response: { status: number; body: Record<string, unknown> },
    code: ApiErrorCode,
  ): void => {
    const documented = API_ERRORS[code];
    const example: Record<string, unknown> = documented.example;
    expect(response.status).toBe(documented.status);
    expect(response.body.code).toBe(code);
    expect(response.body.message).toBe(example.message);
    expect(Object.keys((response.body.details as object | undefined) ?? {}).sort()).toEqual(
      Object.keys((example.details as object | undefined) ?? {}).sort(),
    );
  };

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const company = await call('post', '/companies', adminToken)
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyId = company.body.id as string;
    hrToken = await signInAs(container, { role: 'HR', companyId });
  });

  it('SITE_ALREADY_EXISTS', async () => {
    const site = { name: 'Cancún Centro', country: 'MX', timeZone: 'America/Cancun' };
    await call('post', '/sites', adminToken).send(site).expect(201);

    const response = await call('post', '/sites', adminToken).send(site);

    expectMatchesExample(response, 'SITE_ALREADY_EXISTS');
  });

  it('FORBIDDEN', async () => {
    const response = await call('post', '/sites', hrToken).send({});

    expectMatchesExample(response, 'FORBIDDEN');
  });

  it('AUTHENTICATION_REQUIRED', async () => {
    const response = await call('get', '/sites', null);

    expectMatchesExample(response, 'AUTHENTICATION_REQUIRED');
  });

  it.fails(
    'GAP: plan 002 ejemplo ROUTE_NOT_FOUND dice "No existe GET /nada" y el API devuelve "No existe GET /api/v1/nada"',
    async () => {
      const response = await call('get', '/nada', adminToken);

      expectMatchesExample(response, 'ROUTE_NOT_FOUND');
    },
  );

  it.fails(
    'GAP: plan 002 ejemplo VALIDATION_ERROR omite la clave "pattern" que Zod incluye en el issue de uuid',
    async () => {
      const employeeId = '00000000-0000-4000-8000-00000000dead';
      const response = await call(
        'put',
        `/companies/${companyId}/employees/${employeeId}/site`,
        adminToken,
      ).send({ siteId: 'no-es-uuid' });

      expectMatchesExample(response, 'VALIDATION_ERROR');
      const example = API_ERRORS.VALIDATION_ERROR.example.details as {
        location: string;
        issues: readonly object[];
      };
      const details = response.body.details as { location: string; issues: object[] };
      expect(details.location).toBe(example.location);
      expect(Object.keys(details.issues[0] ?? {}).sort()).toEqual(
        Object.keys(example.issues[0] ?? {}).sort(),
      );
    },
  );

  it('SITE_COUNTRY_MISMATCH', async () => {
    const created = await container.cradle.createSite.execute({
      name: 'Santo Domingo',
      country: 'DO',
      timeZone: 'America/Santo_Domingo',
    });
    if (!created.ok) throw created.error;
    const employee = await call('post', `/companies/${companyId}/employees`, adminToken).send({
      nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
      rfc: 'GOMA850101AB1',
      firstName: 'Ana',
      lastName: 'Rojas',
      email: 'ana@aps.example',
      hireDate: '2026-01-10',
      siteId: created.value.id,
    });

    expectMatchesExample(employee, 'SITE_COUNTRY_MISMATCH');
  });
});
