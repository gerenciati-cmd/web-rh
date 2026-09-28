import { err } from '@rrhh/domain';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { EmployeeAlreadyExistsError } from '@/modules/employees/domain/errors';
import { CompanyAlreadyExistsError } from '@/modules/organization/domain/errors';

import { buildTestApp, buildTestContainer } from './test-app';

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

  const validCompany = { legalName: 'APS Holding SpA', taxId: 'EKU9003173C9', country: 'MX' };

  it('GET /health/live responde ok', async () => {
    await request(app).get('/health/live').expect(200, { status: 'ok' });
  });

  it('crea y lista empresas', async () => {
    const created = await createCompany(validCompany).expect(201);
    expect(created.body.id).toEqual(expect.any(String));

    const list = await request(app).get(`${API_PREFIX}/companies`).expect(200);
    expect(list.body).toMatchObject({ total: 1, items: [{ taxId: 'EKU9003173C9' }] });
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
        nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
        firstName: 'Ana',
        lastName: 'Rojas',
        email: 'ana@aps.cl',
        hireDate: '2026-01-10',
      })
      .expect(201);

    const list = await request(app).get(`${API_PREFIX}/companies/${body.id}/employees`).expect(200);
    expect(list.body.items[0]).toMatchObject({
      fullName: 'Ana Rojas',
      nationalId: 'GOMA850101HQRRRN04',
    });
  });

  it('mapea el conflicto durante save de empresa a 409', async () => {
    const container = buildTestContainer();
    vi.spyOn(container.cradle.companyRepository, 'save').mockResolvedValue(
      err(new CompanyAlreadyExistsError('EKU9003173C9')),
    );
    const response = await request(createApp(container))
      .post(`${API_PREFIX}/companies`)
      .send(validCompany)
      .expect(409);
    expect(response.body.code).toBe('COMPANY_ALREADY_EXISTS');
    await container.dispose();
  });
  it('mapea el conflicto durante save de colaborador a 409', async () => {
    const container = buildTestContainer();
    const localApp = createApp(container);
    const company = await request(localApp)
      .post(`${API_PREFIX}/companies`)
      .send(validCompany)
      .expect(201);
    vi.spyOn(container.cradle.employeeRepository, 'save').mockResolvedValue(
      err(new EmployeeAlreadyExistsError('GOMA850101HQRRRN04')),
    );
    const response = await request(localApp)
      .post(`${API_PREFIX}/companies/${company.body.id}/employees`)
      .send({
        nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
        firstName: 'Fixture',
        lastName: 'Persona',
        email: 'fixture@example.invalid',
        hireDate: '2026-01-10',
      })
      .expect(409);
    expect(response.body.code).toBe('EMPLOYEE_ALREADY_EXISTS');
    await container.dispose();
  });
});
