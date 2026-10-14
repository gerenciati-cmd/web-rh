import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Jornadas diarias guardadas (plan attendance-asistencia-diaria/002): HTTP sobre el contenedor
 * real con persistencia en memoria. Las marcaciones entran por /iclock como en producción; las
 * fechas del escenario ya pasaron, así que están cerradas con el reloj real.
 */
const NO_EMPLOYEE = '00000000-0000-4000-8000-00000000beef';
const device = { serialNumber: 'WORKDAYSN01', name: 'Entrada' };

const WORK = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const REST = { type: 'REST' };
const officeShift = {
  name: 'Oficina',
  cycleStartDate: '2026-10-05',
  toleranceMinutes: 10,
  days: [WORK, WORK, WORK, WORK, WORK, REST, REST],
};
const nightShift = {
  name: 'Noche',
  cycleStartDate: '2026-10-05',
  toleranceMinutes: 10,
  days: [{ type: 'WORK', start: '22:00', end: '06:00', mealBreakMinutes: 30 }, REST],
};

const ana = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};
const luis = {
  nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
  rfc: 'PEXL900215AB2',
  firstName: 'Luis',
  lastName: 'Perez',
  email: 'luis@aps.example',
  hireDate: '2026-01-10',
};
const rosa = {
  nationalId: { country: 'MX', number: 'ROSA010305HQRDNLA3' },
  rfc: 'ROSA010305AB1',
  firstName: 'Rosa',
  lastName: 'Diaz',
  email: 'rosa@aps.example',
  hireDate: '2026-10-07',
};
const dominican = {
  nationalId: { country: 'DO', number: '00113918205' },
  firstName: 'Pedro',
  lastName: 'Araya',
  email: 'pedro@aps.example',
  hireDate: '2026-01-10',
};

/** Línea ATTLOG: PIN, hora local, status, verifyMode y el relleno del formato del equipo. */
const attlog = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`;

interface WorkdayBody {
  date: string;
  shiftName: string;
  status: string;
  scheduledStartAt: string | null;
  scheduledEndAt: string | null;
  scheduledMinutes: number;
  firstPunchAt: string | null;
  lastPunchAt: string | null;
  punchCount: number;
  lateMinutes: number;
  workedMinutes: number;
  overtimeMinutes: number;
}

describe('Jornadas diarias (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrAToken: string;
  let hrBToken: string;
  let companyA: string;
  let companyB: string;
  let siteId: string;
  let anaId: string;
  let luisId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const base = (companyId: string, employeeId: string) =>
    `/companies/${companyId}/attendance/employees/${employeeId}/workdays`;
  const recalculate = (
    body: object,
    token: string | null = hrAToken,
    companyId = companyA,
    employeeId = anaId,
  ) => call('post', `${base(companyId, employeeId)}/recalculation`, token).send(body);
  const list = (
    query: string,
    token: string | null = hrAToken,
    companyId = companyA,
    employeeId = anaId,
  ) => call('get', `${base(companyId, employeeId)}${query}`, token);
  const itemsOf = (response: request.Response) => (response.body as { items: WorkdayBody[] }).items;
  const week = { from: '2026-10-05', to: '2026-10-11' };

  function push(body: string) {
    return request(app)
      .post(`/iclock/cdata?SN=${device.serialNumber}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body);
  }
  async function createCompany(legalName: string, taxId: string): Promise<string> {
    const response = await call('post', '/companies', adminToken)
      .send({ legalName, taxId, country: 'MX' })
      .expect(201);
    return response.body.id as string;
  }
  async function hire(companyId: string, body: object): Promise<string> {
    const response = await call('post', `/companies/${companyId}/employees`, adminToken)
      .send({ siteId, ...body })
      .expect(201);
    return response.body.id as string;
  }
  async function createAndAssign(
    companyId: string,
    employeeId: string,
    shift: object,
    effectiveFrom: string,
  ) {
    const created = await call('post', `/companies/${companyId}/attendance/shifts`, adminToken)
      .send(shift)
      .expect(201);
    await call(
      'put',
      `/companies/${companyId}/attendance/employees/${employeeId}/shift-assignments/${effectiveFrom}`,
      adminToken,
    )
      .send({ shiftId: created.body.id })
      .expect(204);
  }
  const weekPunches = () =>
    push(
      [
        ['2026-10-05 08:00:00', '2026-10-05 18:00:00'],
        ['2026-10-06 09:15:00', '2026-10-06 18:00:00'],
        ['2026-10-07 09:10:00', '2026-10-07 18:00:00'],
        ['2026-10-08 09:00:00'],
        ['2026-10-10 10:00:00', '2026-10-10 12:00:00'],
      ]
        .flat()
        .map((time) => attlog(ana.rfc, time))
        .join(''),
    ).expect(200);

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container);
    companyA = await createCompany('Alfa SA de CV', 'EKU9003173C9');
    companyB = await createCompany('Beta SA de CV', 'AAA010101AAA');
    hrAToken = await signInAs(container, { role: 'HR', companyId: companyA });
    hrBToken = await signInAs(container, { role: 'HR', companyId: companyB });
    anaId = await hire(companyA, ana);
    luisId = await hire(companyB, luis);
    await call('post', '/attendance/devices', adminToken)
      .send({ ...device, siteId })
      .expect(201);
  });

  describe('escenario de la semana (oficina, Cancún)', () => {
    beforeEach(async () => {
      await createAndAssign(companyA, anaId, officeShift, '2026-10-05');
      await weekPunches();
    });

    it('recalcula la semana: 7 fechas cerradas, 6 jornadas, ninguna pendiente', async () => {
      const response = await recalculate(week).expect(200);

      expect(response.body).toEqual({
        recalculatedDates: 7,
        storedWorkdays: 6,
        pendingDates: [],
      });
    });

    it('la lista devuelve las jornadas ascendentes con retardo, trabajado y horas extra', async () => {
      await recalculate(week).expect(200);

      const response = await list('?from=2026-10-05&to=2026-10-11').expect(200);

      const rows = itemsOf(response);
      expect(
        rows.map((row) => [
          row.date,
          row.status,
          row.punchCount,
          row.lateMinutes,
          row.workedMinutes,
          row.overtimeMinutes,
        ]),
      ).toEqual([
        ['2026-10-05', 'ATTENDED', 2, 0, 540, 60],
        ['2026-10-06', 'ATTENDED', 2, 15, 465, 0],
        ['2026-10-07', 'ATTENDED', 2, 0, 470, 0],
        ['2026-10-08', 'ABSENT_SINGLE_PUNCH', 1, 0, 0, 0],
        ['2026-10-09', 'ABSENT_NO_PUNCHES', 0, 0, 0, 0],
        ['2026-10-10', 'REST_WORKED', 2, 0, 120, 120],
      ]);
      expect(rows[0]).toMatchObject({
        shiftName: 'Oficina',
        scheduledMinutes: 480,
        scheduledStartAt: '2026-10-05T14:00:00.000Z',
        scheduledEndAt: '2026-10-05T23:00:00.000Z',
        firstPunchAt: '2026-10-05T13:00:00.000Z',
        lastPunchAt: '2026-10-05T23:00:00.000Z',
      });
      expect(rows[5]).toMatchObject({
        scheduledStartAt: null,
        scheduledEndAt: null,
        scheduledMinutes: 0,
      });
    });

    it('la lista respeta el rango pedido y no incluye fechas sin jornada (el domingo)', async () => {
      await recalculate(week).expect(200);

      const response = await list('?from=2026-10-08&to=2026-10-11').expect(200);

      expect(itemsOf(response).map((row) => row.date)).toEqual([
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
      ]);
    });

    it('sin recalcular, la lista está vacía', async () => {
      const response = await list('?from=2026-10-05&to=2026-10-11').expect(200);

      expect(response.body).toEqual({ items: [] });
    });

    it('recalcular de nuevo reemplaza las filas: sin duplicados y con la marcación nueva', async () => {
      await recalculate(week).expect(200);
      await push(attlog(ana.rfc, '2026-10-08 18:00:00')).expect(200);

      const second = await recalculate(week).expect(200);

      expect(second.body).toMatchObject({ recalculatedDates: 7, storedWorkdays: 6 });
      const rows = itemsOf(await list('?from=2026-10-05&to=2026-10-11').expect(200));
      expect(rows).toHaveLength(6);
      expect(rows[3]).toMatchObject({
        date: '2026-10-08',
        status: 'ATTENDED',
        punchCount: 2,
        workedMinutes: 480,
      });
    });

    it('un colaborador desvinculado se puede recalcular y solo tiene jornadas hasta su baja', async () => {
      await call('post', `/companies/${companyA}/employees/${anaId}/termination`, adminToken)
        .send({ terminationDate: '2026-10-07', reason: 'DEATH' })
        .expect(204);

      const response = await recalculate(week).expect(200);

      expect(response.body).toEqual({ recalculatedDates: 7, storedWorkdays: 3, pendingDates: [] });
      const rows = itemsOf(await list('?from=2026-10-05&to=2026-10-11').expect(200));
      expect(rows.map((row) => row.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    });

    it('las marcaciones de otro colaborador no se atribuyen', async () => {
      await push(
        attlog(luis.rfc, '2026-10-09 09:00:00') + attlog(luis.rfc, '2026-10-09 18:00:00'),
      ).expect(200);

      await recalculate(week).expect(200);

      const rows = itemsOf(await list('?from=2026-10-09&to=2026-10-09').expect(200));
      expect(rows[0]).toMatchObject({ status: 'ABSENT_NO_PUNCHES', punchCount: 0 });
    });
  });

  it('no hay jornadas antes de la contratación', async () => {
    const rosaId = await hire(companyA, rosa);
    await createAndAssign(companyA, rosaId, officeShift, '2026-10-05');

    const response = await recalculate(week, hrAToken, companyA, rosaId).expect(200);

    // Contratada el miércoles 2026-10-07: lunes y martes no tienen fila.
    expect(response.body).toEqual({ recalculatedDates: 7, storedWorkdays: 3, pendingDates: [] });
    const rows = itemsOf(await list('?from=2026-10-05&to=2026-10-11', hrAToken, companyA, rosaId));
    expect(rows.map((row) => row.date)).toEqual(['2026-10-07', '2026-10-08', '2026-10-09']);
  });

  it('turno nocturno: una sola jornada en el día de la entrada y ninguna en el siguiente', async () => {
    await createAndAssign(companyB, luisId, nightShift, '2026-10-05');
    await push(
      attlog(luis.rfc, '2026-10-05 21:50:00') + attlog(luis.rfc, '2026-10-06 06:05:00'),
    ).expect(200);

    const response = await recalculate(
      { from: '2026-10-05', to: '2026-10-06' },
      hrBToken,
      companyB,
      luisId,
    ).expect(200);

    expect(response.body).toEqual({ recalculatedDates: 2, storedWorkdays: 1, pendingDates: [] });
    const rows = itemsOf(
      await list('?from=2026-10-05&to=2026-10-06', hrBToken, companyB, luisId).expect(200),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-10-05',
      shiftName: 'Noche',
      status: 'ATTENDED',
      workedMinutes: 465,
      scheduledMinutes: 450,
      overtimeMinutes: 15,
      lateMinutes: 0,
    });
  });

  it('viernes con salida a las 00:30 del sábado: horas extra del viernes y sin fila el sábado (revisión Low-3)', async () => {
    await createAndAssign(companyA, anaId, officeShift, '2026-10-05');
    await push(
      attlog(ana.rfc, '2026-10-09 09:00:00') + attlog(ana.rfc, '2026-10-10 00:30:00'),
    ).expect(200);

    const response = await recalculate({ from: '2026-10-09', to: '2026-10-10' }).expect(200);

    expect(response.body).toEqual({ recalculatedDates: 2, storedWorkdays: 1, pendingDates: [] });
    const rows = itemsOf(await list('?from=2026-10-09&to=2026-10-10').expect(200));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      date: '2026-10-09',
      status: 'ATTENDED',
      punchCount: 2,
      lastPunchAt: '2026-10-10T05:30:00.000Z',
      workedMinutes: 870,
      overtimeMinutes: 390,
    });
  });

  it('hoy está pendiente: no se calcula ni se guarda', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await createAndAssign(companyA, anaId, officeShift, '2026-10-05');

    const response = await recalculate({ from: today, to: today }).expect(200);

    expect(response.body).toEqual({
      recalculatedDates: 0,
      storedWorkdays: 0,
      pendingDates: [today],
    });
    expect((await list(`?from=${today}&to=${today}`).expect(200)).body).toEqual({ items: [] });
  });

  describe('errores', () => {
    it('colaborador sin RFC: 422 EMPLOYEE_WITHOUT_RFC', async () => {
      const pedroId = await hire(companyA, dominican);

      const response = await recalculate(week, hrAToken, companyA, pedroId).expect(422);

      expect(response.body.code).toBe('EMPLOYEE_WITHOUT_RFC');
      expect(response.body.details).toEqual({ employeeId: pedroId });
    });

    it('colaborador de otra empresa: 404 EMPLOYEE_NOT_FOUND en recalcular y en listar', async () => {
      const recalculated = await recalculate(week, hrAToken, companyA, luisId).expect(404);
      const listed = await list(
        '?from=2026-10-05&to=2026-10-11',
        hrAToken,
        companyA,
        luisId,
      ).expect(404);

      expect(recalculated.body.code).toBe('EMPLOYEE_NOT_FOUND');
      expect(listed.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it('colaborador inexistente: 404 EMPLOYEE_NOT_FOUND', async () => {
      const response = await recalculate(week, hrAToken, companyA, NO_EMPLOYEE).expect(404);

      expect(response.body.code).toBe('EMPLOYEE_NOT_FOUND');
    });

    it.each([
      ['to anterior a from', { from: '2026-10-11', to: '2026-10-05' }],
      ['63 días', { from: '2026-10-01', to: '2026-12-02' }],
      ['fecha con formato inválido', { from: '05/10/2026', to: '2026-10-11' }],
      ['sin to', { from: '2026-10-05' }],
    ])('recalcular con %s: 400 VALIDATION_ERROR', async (_name, body) => {
      const response = await recalculate(body).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('listar con un rango invertido o de 63 días: 400 VALIDATION_ERROR', async () => {
      const inverted = await list('?from=2026-10-11&to=2026-10-05').expect(400);
      const tooLong = await list('?from=2026-10-01&to=2026-12-02').expect(400);

      expect(inverted.body.code).toBe('VALIDATION_ERROR');
      expect(tooLong.body.code).toBe('VALIDATION_ERROR');
    });

    it('exactamente 62 días se acepta', async () => {
      await recalculate({ from: '2026-10-01', to: '2026-12-01' }).expect(200);
    });
  });

  describe('acceso', () => {
    it('RH de otra empresa: 403 FORBIDDEN en ambas rutas', async () => {
      const recalculated = await recalculate(week, hrBToken).expect(403);
      const listed = await list('?from=2026-10-05&to=2026-10-11', hrBToken).expect(403);

      expect(recalculated.body.code).toBe('FORBIDDEN');
      expect(listed.body.code).toBe('FORBIDDEN');
    });

    it('sin sesión: 401 AUTHENTICATION_REQUIRED en ambas rutas', async () => {
      const recalculated = await recalculate(week, null).expect(401);
      const listed = await list('?from=2026-10-05&to=2026-10-11', null).expect(401);

      expect(recalculated.body.code).toBe('AUTHENTICATION_REQUIRED');
      expect(listed.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('HOLDING_ADMIN puede recalcular y leer en cualquier empresa', async () => {
      await recalculate(week, adminToken).expect(200);
      await list('?from=2026-10-05&to=2026-10-11', adminToken).expect(200);
    });
  });
});
