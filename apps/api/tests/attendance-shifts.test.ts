import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Turnos por empresa y su asignación a colaboradores (plan attendance-asistencia-diaria/001):
 * HTTP sobre el contenedor real con persistencia en memoria.
 */
const NO_COMPANY = '00000000-0000-4000-8000-00000000dead';
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000beef';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const WORK = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const REST = { type: 'REST' };
const officeShift = {
  name: 'Oficina',
  cycleStartDate: '2026-11-02',
  toleranceMinutes: 10,
  days: [WORK, WORK, WORK, WORK, WORK, REST, REST],
};

const mexican = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};

describe('Turnos y asignaciones (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrAToken: string;
  let hrBToken: string;
  let companyA: string;
  let companyB: string;
  let employeeA: string;
  let employeeB: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const createShift = (
    body: object = officeShift,
    token: string | null = hrAToken,
    id = companyA,
  ) => call('post', `/companies/${id}/attendance/shifts`, token).send(body);
  const assign = (
    effectiveFrom: string,
    shiftId: string,
    token: string | null = hrAToken,
    companyId = companyA,
    employeeId = employeeA,
  ) =>
    call(
      'put',
      `/companies/${companyId}/attendance/employees/${employeeId}/shift-assignments/${effectiveFrom}`,
      token,
    ).send({ shiftId });
  const history = (token: string | null = hrAToken, companyId = companyA, employeeId = employeeA) =>
    call(
      'get',
      `/companies/${companyId}/attendance/employees/${employeeId}/shift-assignments`,
      token,
    );

  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }

  async function hire(companyId: string, body: object): Promise<string> {
    const response = await call('post', `/companies/${companyId}/employees`, adminToken)
      .send(body)
      .expect(201);
    return response.body.id as string;
  }

  async function shiftId(name: string, companyId = companyA): Promise<string> {
    const response = await createShift({ ...officeShift, name }, adminToken, companyId).expect(201);
    return response.body.id as string;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
    employeeA = await hire(companyA, { ...mexican, siteId });
    employeeB = await hire(companyB, {
      ...mexican,
      nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
      rfc: 'PEXL900215AB2',
      email: 'luis@aps.example',
      siteId,
    });
  });

  describe('POST /companies/:companyId/attendance/shifts', () => {
    it('RH de la empresa crea un turno semanal: 201 con id', async () => {
      const response = await createShift().expect(201);

      expect(response.body.id).toMatch(UUID);
    });

    it('el mismo nombre con otras mayúsculas: 409 SHIFT_ALREADY_EXISTS', async () => {
      await createShift().expect(201);

      const response = await createShift({ ...officeShift, name: 'OFICINA' }).expect(409);

      expect(response.body.code).toBe('SHIFT_ALREADY_EXISTS');
    });

    it('el mismo nombre en otra empresa: 201', async () => {
      await createShift().expect(201);

      await createShift(officeShift, adminToken, companyB).expect(201);
    });

    it('acepta un turno nocturno y uno 24x24', async () => {
      await createShift({
        ...officeShift,
        name: 'Noche',
        days: [{ type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 0 }],
      }).expect(201);
      await createShift({
        ...officeShift,
        name: '24x24',
        days: [{ type: 'WORK', start: '08:00', end: '08:00', mealBreakMinutes: 0 }, REST],
      }).expect(201);
    });

    it.each([
      ['solo días de descanso', { days: [REST, REST] }],
      ['29 días', { days: [WORK, ...Array.from({ length: 28 }, () => REST)] }],
      ['comida igual a la jornada', { days: [{ ...WORK, start: '09:00', end: '10:00' }] }],
      ['hora 24:00', { days: [{ ...WORK, start: '24:00' }] }],
      ['tolerancia 61', { toleranceMinutes: 61 }],
      ['nombre vacío', { name: '' }],
    ])('%s: 400 VALIDATION_ERROR', async (_name, override) => {
      const response = await createShift({ ...officeShift, ...override }).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('empresa inexistente como HOLDING_ADMIN: 404 COMPANY_NOT_FOUND', async () => {
      const response = await createShift(officeShift, adminToken, NO_COMPANY).expect(404);

      expect(response.body.code).toBe('COMPANY_NOT_FOUND');
    });

    it('RH de otra empresa: 403 FORBIDDEN', async () => {
      const response = await createShift(officeShift, hrBToken).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const response = await createShift(officeShift, null).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('GET /companies/:companyId/attendance/shifts', () => {
    it('lista solo los turnos de la empresa, por nombre, con los días tal como se enviaron', async () => {
      await shiftId('Zeta');
      await shiftId('Alfa');
      await shiftId('Otra empresa', companyB);
      await createShift({
        ...officeShift,
        name: 'Sin comida',
        days: [{ type: 'WORK', start: '08:00', end: '12:00' }],
      }).expect(201);

      const response = await call(
        'get',
        `/companies/${companyA}/attendance/shifts`,
        hrAToken,
      ).expect(200);

      const items = response.body.items as { name: string; days: unknown[] }[];
      expect(items.map((item) => item.name)).toEqual(['Alfa', 'Sin comida', 'Zeta']);
      expect(response.body.total).toBe(3);
      expect(items[0]).toMatchObject({
        cycleStartDate: '2026-11-02',
        toleranceMinutes: 10,
        active: true,
        days: officeShift.days,
      });
      // La comida omitida se devuelve como 0.
      expect(items[1]?.days).toEqual([
        { type: 'WORK', start: '08:00', end: '12:00', mealBreakMinutes: 0 },
      ]);
    });

    it('pagina', async () => {
      await shiftId('A');
      await shiftId('B');

      const response = await call(
        'get',
        `/companies/${companyA}/attendance/shifts?page=2&pageSize=1`,
        hrAToken,
      ).expect(200);

      expect((response.body.items as { name: string }[]).map((item) => item.name)).toEqual(['B']);
      expect(response.body.total).toBe(2);
    });

    it('RH de otra empresa: 403', async () => {
      await call('get', `/companies/${companyA}/attendance/shifts`, hrBToken).expect(403);
    });
  });

  describe('PUT .../shift-assignments/:effectiveFrom', () => {
    it('asigna: 204 y aparece en el historial con shiftName, assignedAt y assignedBy', async () => {
      const id = await shiftId('Oficina');

      const response = await assign('2026-11-02', id).expect(204);

      expect(response.body).toEqual({});
      const listed = await history().expect(200);
      expect(listed.body.items).toEqual([
        {
          effectiveFrom: '2026-11-02',
          shiftId: id,
          shiftName: 'Oficina',
          assignedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/) as string,
          assignedBy: expect.stringMatching(UUID) as string,
        },
      ]);
    });

    it('repetir la fecha con otro turno: 204 y una sola fila con el turno nuevo', async () => {
      const first = await shiftId('Primero');
      const second = await shiftId('Segundo');
      await assign('2026-11-02', first).expect(204);

      await assign('2026-11-02', second).expect(204);

      const listed = await history().expect(200);
      expect(listed.body.total).toBe(1);
      expect(listed.body.items[0]).toMatchObject({ shiftId: second, shiftName: 'Segundo' });
    });

    it('una segunda fecha agrega una fila y el historial va de la más reciente a la más antigua', async () => {
      const id = await shiftId('Oficina');
      await assign('2026-11-02', id).expect(204);
      await assign('2026-12-07', id).expect(204);
      await assign('2026-01-05', id).expect(204);

      const listed = await history().expect(200);

      expect(
        (listed.body.items as { effectiveFrom: string }[]).map((i) => i.effectiveFrom),
      ).toEqual(['2026-12-07', '2026-11-02', '2026-01-05']);
    });

    it('colaborador de otra empresa: 404 EMPLOYEE_NOT_FOUND', async () => {
      const id = await shiftId('Oficina');

      const response = await assign('2026-11-02', id, hrAToken, companyA, employeeB).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('colaborador inexistente: 404 EMPLOYEE_NOT_FOUND', async () => {
      const id = await shiftId('Oficina');

      const response = await assign('2026-11-02', id, hrAToken, companyA, NO_EMPLOYEE).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('turno de otra empresa: 404 SHIFT_NOT_FOUND', async () => {
      const foreign = await shiftId('Ajeno', companyB);

      const response = await assign('2026-11-02', foreign).expect(404);

      expect(response.body.code).toBe('SHIFT_NOT_FOUND');
    });

    it('colaborador desvinculado: 422 EMPLOYEE_INACTIVE', async () => {
      const id = await shiftId('Oficina');
      await call('post', `/companies/${companyA}/employees/${employeeA}/termination`, adminToken)
        .send({ terminationDate: '2026-02-15', reason: 'DEATH' })
        .expect(204);

      const response = await assign('2026-11-02', id).expect(422);

      expect(response.body.code).toBe('EMPLOYEE_INACTIVE');
    });

    it.each([
      ['fecha con formato inválido', '02-11-2026', undefined],
      ['shiftId que no es uuid', '2026-11-02', 'no-uuid'],
    ])('%s: 400 VALIDATION_ERROR', async (_name, date, id) => {
      const response = await assign(date, id ?? (await shiftId('Oficina'))).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('RH de otra empresa: 403', async () => {
      const id = await shiftId('Oficina');

      await assign('2026-11-02', id, hrBToken).expect(403);
    });
  });

  describe('GET .../shift-assignments', () => {
    it('colaborador sin asignaciones: página vacía', async () => {
      const response = await history().expect(200);

      expect(response.body).toMatchObject({ items: [], total: 0 });
    });

    it('colaborador de otra empresa: 404 EMPLOYEE_NOT_FOUND', async () => {
      const response = await history(hrAToken, companyA, employeeB).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('RH de otra empresa: 403', async () => {
      await history(hrBToken).expect(403);
    });
  });
});
