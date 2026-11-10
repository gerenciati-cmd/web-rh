import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { FixedClock } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs, signInAsEmployee } from './test-app';

/**
 * Mis jornadas del colaborador (plan attendance-asistencia-diaria/005): HTTP sobre el contenedor
 * real con persistencia en memoria. El reloj se fija el martes 2026-11-10 a las 10:00 de Cancún
 * (15:00 UTC): noviembre es el mes actual y octubre el anterior. Las marcaciones entran por
 * /iclock y las jornadas se guardan con el recálculo de personal, como en producción.
 */
const device = { serialNumber: 'MYWORKDAYSN1', name: 'Entrada' };
const WORK = { type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 };
const REST = { type: 'REST' };
const officeShift = {
  name: 'Oficina',
  cycleStartDate: '2026-10-05',
  toleranceMinutes: 10,
  days: [WORK, WORK, WORK, WORK, WORK, REST, REST],
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
const rosaData = {
  nationalId: { country: 'MX', number: 'ROSA010305HQRDNLA3' },
  rfc: 'ROSA010305AB1',
  firstName: 'Rosa',
  lastName: 'Diaz',
  email: 'rosa@aps.example',
  hireDate: '2026-01-10',
};

/** Línea ATTLOG: PIN, hora local, status, verifyMode y el relleno del formato del equipo. */
const attlog = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`;

interface MyTodayBody {
  date: string;
  timeZone: string;
  shift: { id: string; name: string; day: Record<string, unknown> } | null;
  punches: string[];
}
interface MyWorkdaysBody {
  month: string;
  items: { date: string; status: string; punchCount: number; shiftName: string }[];
}

describe('Mis jornadas y mi día de hoy (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrToken: string;
  let anaToken: string;
  let companyId: string;
  let siteId: string;
  let anaId: string;
  let luisId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const push = (body: string) =>
    request(app)
      .post(`/iclock/cdata?SN=${device.serialNumber}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body)
      .expect(200);
  async function hire(body: object): Promise<string> {
    const response = await call('post', `/companies/${companyId}/employees`, adminToken)
      .send({ siteId, ...body })
      .expect(201);
    return (response.body as { id: string }).id;
  }
  /** El alta exige sede; un colaborador anterior a ese campo se simula quitándosela del repositorio. */
  async function hireWithoutSite(body: object): Promise<string> {
    const id = await hire(body);
    const repository = container.cradle.employeeRepository;
    const employee = await repository.findById(id as EmployeeId);
    if (!employee) throw new Error('fixture inválido');
    await repository.saveSite(
      Employee.restore(employee.id, { ...employee.snapshot, siteId: null }),
    );
    return id;
  }
  async function assignOffice(employeeId: string, shiftId: string) {
    await call(
      'put',
      `/companies/${companyId}/attendance/employees/${employeeId}/shift-assignments/2026-10-05`,
      adminToken,
    )
      .send({ shiftId })
      .expect(204);
  }
  const recalculate = (employeeId: string, from: string, to: string) =>
    call(
      'post',
      `/companies/${companyId}/attendance/employees/${employeeId}/workdays/recalculation`,
      hrToken,
    )
      .send({ from, to })
      .expect(200);

  beforeEach(async () => {
    container = buildTestContainer();
    container.register({ clock: asValue(new FixedClock(new Date('2026-11-10T15:00:00Z'))) });
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container);
    const company = await call('post', '/companies', adminToken)
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyId = (company.body as { id: string }).id;
    hrToken = await signInAs(container, { role: 'HR', companyId });
    anaId = await hire(ana);
    luisId = await hire(luis);
    await call('post', '/attendance/devices', adminToken)
      .send({ ...device, siteId })
      .expect(201);
    const shift = await call('post', `/companies/${companyId}/attendance/shifts`, adminToken)
      .send(officeShift)
      .expect(201);
    const shiftId = (shift.body as { id: string }).id;
    await assignOffice(anaId, shiftId);
    await assignOffice(luisId, shiftId);
    anaToken = await signInAsEmployee(container, { companyId, employeeId: anaId });
  });

  describe('GET /me/attendance/workdays', () => {
    beforeEach(async () => {
      const punches: [string, string][] = [
        [ana.rfc, '2026-10-30 09:00:00'],
        [ana.rfc, '2026-10-30 18:00:00'],
        [ana.rfc, '2026-11-09 08:55:00'],
        [ana.rfc, '2026-11-09 18:00:00'],
        [luis.rfc, '2026-11-09 09:00:00'],
      ];
      await push(punches.map(([pin, time]) => attlog(pin, time)).join(''));
      await recalculate(anaId, '2026-10-26', '2026-10-30');
      await recalculate(anaId, '2026-11-02', '2026-11-09');
      await recalculate(luisId, '2026-11-09', '2026-11-09');
    });

    it('el mes actual devuelve 200 con las jornadas propias guardadas y el mes consultado', async () => {
      const response = await call('get', '/me/attendance/workdays?month=2026-11', anaToken).expect(
        200,
      );

      const body = response.body as MyWorkdaysBody;
      expect(body.month).toBe('2026-11');
      expect(body.items.map((item) => item.date)).toEqual([
        '2026-11-02',
        '2026-11-03',
        '2026-11-04',
        '2026-11-05',
        '2026-11-06',
        '2026-11-09',
      ]);
      expect(body.items.at(-1)).toMatchObject({
        status: 'ATTENDED',
        punchCount: 2,
        shiftName: 'Oficina',
      });
    });

    it('usa los mismos campos que la ruta de personal para la misma jornada', async () => {
      const mine = await call('get', '/me/attendance/workdays?month=2026-11', anaToken).expect(200);
      const staff = await call(
        'get',
        `/companies/${companyId}/attendance/employees/${anaId}/workdays?from=2026-11-09&to=2026-11-09`,
        hrToken,
      ).expect(200);

      expect((mine.body as MyWorkdaysBody).items.at(-1)).toEqual(
        (staff.body as { items: unknown[] }).items[0],
      );
    });

    it('el mes anterior devuelve 200 con sus jornadas', async () => {
      const response = await call('get', '/me/attendance/workdays?month=2026-10', anaToken).expect(
        200,
      );

      const body = response.body as MyWorkdaysBody;
      expect(body.month).toBe('2026-10');
      expect(body.items.map((item) => item.date)).toEqual([
        '2026-10-26',
        '2026-10-27',
        '2026-10-28',
        '2026-10-29',
        '2026-10-30',
      ]);
    });

    it.each([
      ['dos meses atrás', '2026-09'],
      ['un mes futuro', '2026-12'],
    ])('%s: 422 MONTH_NOT_AVAILABLE con el mes en los detalles', async (_name, month) => {
      const response = await call('get', `/me/attendance/workdays?month=${month}`, anaToken).expect(
        422,
      );

      expect(response.body).toMatchObject({
        code: 'MONTH_NOT_AVAILABLE',
        details: { month },
      });
    });

    it.each(['2026-13', '2026-1', 'noviembre', ''])(
      'month mal formado (%j): 400 VALIDATION_ERROR',
      async (month) => {
        const response = await call(
          'get',
          `/me/attendance/workdays?month=${month}`,
          anaToken,
        ).expect(400);

        expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
      },
    );

    it('sin month: 400 VALIDATION_ERROR', async () => {
      const response = await call('get', '/me/attendance/workdays', anaToken).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('ninguna entrada elige al colaborador: un employeeId en la consulta se ignora y solo ve lo propio', async () => {
      const response = await call(
        'get',
        `/me/attendance/workdays?month=2026-11&employeeId=${luisId}`,
        anaToken,
      ).expect(200);

      const luisWorkday = (response.body as MyWorkdaysBody).items.find(
        (item) => item.date === '2026-11-09',
      );
      expect(luisWorkday).toMatchObject({ punchCount: 2 });
    });
  });

  describe('GET /me/attendance/today', () => {
    it('día laborable: fecha local, zona, turno con horario, comida y tolerancia, y las marcaciones de hoy', async () => {
      await push(
        attlog(ana.rfc, '2026-11-09 18:05:00') + // ayer: fuera de la ventana de hoy
          attlog(ana.rfc, '2026-11-10 08:56:00'),
      );

      const response = await call('get', '/me/attendance/today', anaToken).expect(200);

      const body = response.body as MyTodayBody;
      expect(body).toMatchObject({
        date: '2026-11-10',
        timeZone: 'America/Cancun',
        shift: {
          name: 'Oficina',
          day: {
            type: 'WORK',
            scheduledStartAt: '2026-11-10T14:00:00.000Z',
            scheduledEndAt: '2026-11-10T23:00:00.000Z',
            scheduledMinutes: 480,
            mealBreakMinutes: 60,
            toleranceMinutes: 10,
          },
        },
      });
      expect(body.punches).toEqual(['2026-11-10T13:56:00.000Z']);
    });

    it('día de descanso: day REST', async () => {
      container.register({ clock: asValue(new FixedClock(new Date('2026-11-15T15:00:00Z'))) });
      app = createApp(container);

      const response = await call('get', '/me/attendance/today', anaToken).expect(200);

      expect(response.body).toMatchObject({
        date: '2026-11-15',
        shift: { name: 'Oficina', day: { type: 'REST' } },
      });
    });

    it('sin turno asignado: shift null y punches vacío', async () => {
      const sinTurno = await hire(rosaData);
      const token = await signInAsEmployee(container, { companyId, employeeId: sinTurno });

      const response = await call('get', '/me/attendance/today', token).expect(200);

      expect(response.body).toEqual({
        date: '2026-11-10',
        timeZone: 'America/Cancun',
        shift: null,
        punches: [],
      });
    });
  });

  describe('acceso y errores de cuenta', () => {
    const routes = ['/me/attendance/workdays?month=2026-11', '/me/attendance/today'];

    it.each(routes)('anónimo: 401 en %s', async (route) => {
      await call('get', route, null).expect(401);
    });

    it.each(routes)('RR. HH. sin read-own: 403 en %s', async (route) => {
      await call('get', route, hrToken).expect(403);
    });

    it.each(routes)(
      'HOLDING_ADMIN sin colaborador vinculado: 422 ACCOUNT_NOT_LINKED en %s',
      async (route) => {
        const response = await call('get', route, adminToken).expect(422);

        expect(response.body).toMatchObject({ code: 'ACCOUNT_NOT_LINKED' });
      },
    );

    it.each(routes)('colaborador sin sede: 422 EMPLOYEE_WITHOUT_SITE en %s', async (route) => {
      const rosa = await hireWithoutSite(rosaData);
      const token = await signInAsEmployee(container, { companyId, employeeId: rosa });

      const response = await call('get', route, token).expect(422);

      expect(response.body).toMatchObject({ code: 'EMPLOYEE_WITHOUT_SITE' });
    });
  });
});
