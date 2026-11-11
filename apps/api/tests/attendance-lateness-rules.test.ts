import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { FixedClock } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs, signInAsEmployee } from './test-app';

/**
 * Regla N retardos = 1 falta (plan attendance-asistencia-diaria/004): HTTP sobre el contenedor real
 * con persistencia en memoria. Reloj fijo: martes 2026-11-10 a las 10:00 de Cancún (15:00 UTC),
 * así que hoy (UTC) es 2026-11-10 y las jornadas hasta el 9 están cerradas. Las marcaciones
 * entran por /iclock y las jornadas se guardan con el recálculo de personal, como en producción.
 */
const TODAY = '2026-11-10';
const NO_COMPANY = '00000000-0000-4000-8000-00000000dead';
const device = { serialNumber: 'LATENESSSN1', name: 'Entrada' };
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

const attlog = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`;

interface WorkdayBody {
  date: string;
  status: string;
  lateMinutes: number;
}
interface RuleBody {
  effectiveFrom: string;
  threshold: number;
  period: string;
  setAt: string;
}
interface RulesBody {
  items: RuleBody[];
  default: { threshold: number; period: string };
}

describe('Regla de retardos (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let hrToken: string;
  let otherHrToken: string;
  let anaToken: string;
  let companyId: string;
  let otherCompanyId: string;
  let anaId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const putRule = (
    effectiveFrom: string,
    body: object = { threshold: 2, period: 'WEEK' },
    token: string | null = hrToken,
    company = companyId,
  ) =>
    call('put', `/companies/${company}/attendance/lateness-rules/${effectiveFrom}`, token).send(
      body,
    );
  const listRules = (token: string | null = hrToken, company = companyId) =>
    call('get', `/companies/${company}/attendance/lateness-rules`, token);
  const push = (body: string) =>
    request(app)
      .post(`/iclock/cdata?SN=${device.serialNumber}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body)
      .expect(200);
  const recalculate = (from: string, to: string) =>
    call(
      'post',
      `/companies/${companyId}/attendance/employees/${anaId}/workdays/recalculation`,
      hrToken,
    )
      .send({ from, to })
      .expect(200);
  const staffWorkdays = async (from: string, to: string): Promise<WorkdayBody[]> => {
    const response = await call(
      'get',
      `/companies/${companyId}/attendance/employees/${anaId}/workdays?from=${from}&to=${to}`,
      hrToken,
    ).expect(200);
    return (response.body as { items: WorkdayBody[] }).items;
  };
  /** Retardo de 30 min: entra a las 09:30 y sale a las 18:00 (tolerancia de 10 min). */
  const lateDay = (date: string) =>
    attlog(ana.rfc, `${date} 09:30:00`) + attlog(ana.rfc, `${date} 18:00:00`);

  beforeEach(async () => {
    container = buildTestContainer();
    container.register({ clock: asValue(new FixedClock(new Date(`${TODAY}T15:00:00Z`))) });
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    const company = await call('post', '/companies', adminToken)
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyId = (company.body as { id: string }).id;
    const other = await call('post', '/companies', adminToken)
      .send({ legalName: 'Beta SA de CV', taxId: 'AAA010101AAA', country: 'MX' })
      .expect(201);
    otherCompanyId = (other.body as { id: string }).id;
    hrToken = await signInAs(container, { role: 'HR', companyId });
    otherHrToken = await signInAs(container, { role: 'HR', companyId: otherCompanyId });
    const hired = await call('post', `/companies/${companyId}/employees`, adminToken)
      .send({ siteId, ...ana })
      .expect(201);
    anaId = (hired.body as { id: string }).id;
    await call('post', '/attendance/devices', adminToken)
      .send({ ...device, siteId })
      .expect(201);
    const shift = await call('post', `/companies/${companyId}/attendance/shifts`, adminToken)
      .send(officeShift)
      .expect(201);
    await call(
      'put',
      `/companies/${companyId}/attendance/employees/${anaId}/shift-assignments/2026-10-05`,
      adminToken,
    )
      .send({ shiftId: (shift.body as { id: string }).id })
      .expect(204);
    anaToken = await signInAsEmployee(container, { companyId, employeeId: anaId });
  });

  describe('PUT /companies/:companyId/attendance/lateness-rules/:effectiveFrom', () => {
    it('RH de la empresa: 204 sin cuerpo, y el GET la lista con la regla por defecto', async () => {
      const response = await putRule('2026-11-16', { threshold: 4, period: 'MONTH' }).expect(204);

      expect(response.body).toEqual({});
      const listed = await listRules().expect(200);
      const body = listed.body as RulesBody;
      expect(body.default).toEqual({ threshold: 3, period: 'FORTNIGHT' });
      expect(body.items).toEqual([
        {
          effectiveFrom: '2026-11-16',
          threshold: 4,
          period: 'MONTH',
          setAt: `${TODAY}T15:00:00.000Z`,
        },
      ]);
    });

    it('administrador del holding también puede definirla', async () => {
      await putRule('2026-11-16', { threshold: 2, period: 'WEEK' }, adminToken).expect(204);

      expect(((await listRules(adminToken)).body as RulesBody).items).toHaveLength(1);
    });

    it('la fecha de hoy se acepta', async () => {
      await putRule(TODAY).expect(204);
    });

    it('repetir la misma fecha reemplaza la regla: una sola con los valores nuevos', async () => {
      await putRule('2026-11-16', { threshold: 2, period: 'WEEK' }).expect(204);

      await putRule('2026-11-16', { threshold: 5, period: 'FORTNIGHT' }).expect(204);

      const items = ((await listRules()).body as RulesBody).items;
      expect(items.map((item) => [item.effectiveFrom, item.threshold, item.period])).toEqual([
        ['2026-11-16', 5, 'FORTNIGHT'],
      ]);
    });

    it('fechas distintas conservan el historial, de la más reciente a la más antigua', async () => {
      await putRule('2026-11-16').expect(204);
      await putRule('2026-12-01').expect(204);

      const items = ((await listRules()).body as RulesBody).items;

      expect(items.map((item) => item.effectiveFrom)).toEqual(['2026-12-01', '2026-11-16']);
    });

    it('fecha pasada: 422 LATENESS_RULE_IN_PAST con effectiveFrom y today en los detalles, y no guarda', async () => {
      const response = await putRule('2026-11-09').expect(422);

      expect(response.body).toMatchObject({
        code: 'LATENESS_RULE_IN_PAST',
        details: { effectiveFrom: '2026-11-09', today: TODAY },
      });
      expect(((await listRules()).body as RulesBody).items).toEqual([]);
    });

    it.each([
      ['threshold 0', { threshold: 0, period: 'WEEK' }],
      ['threshold 32', { threshold: 32, period: 'WEEK' }],
      ['threshold decimal', { threshold: 2.5, period: 'WEEK' }],
      ['periodo desconocido', { threshold: 3, period: 'YEAR' }],
      ['sin periodo', { threshold: 3 }],
      ['sin cuerpo', {}],
    ])('%s: 400 VALIDATION_ERROR', async (_name, body) => {
      const response = await putRule('2026-11-16', body).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('una fecha mal formada en la ruta: 400 VALIDATION_ERROR', async () => {
      const response = await putRule('mañana').expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('empresa inexistente (administrador del holding): 404 COMPANY_NOT_FOUND', async () => {
      const response = await putRule('2026-11-16', undefined, adminToken, NO_COMPANY).expect(404);

      expect(response.body).toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    });

    it('RH de otra empresa: 403 FORBIDDEN y no guarda', async () => {
      const response = await putRule('2026-11-16', undefined, otherHrToken).expect(403);

      expect(response.body).toMatchObject({ code: 'FORBIDDEN' });
      expect(((await listRules()).body as RulesBody).items).toEqual([]);
    });

    it('colaborador: 403 FORBIDDEN', async () => {
      await putRule('2026-11-16', undefined, anaToken).expect(403);
    });

    it('sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const response = await putRule('2026-11-16', undefined, null).expect(401);

      expect(response.body).toMatchObject({ code: 'AUTHENTICATION_REQUIRED' });
    });
  });

  describe('GET /companies/:companyId/attendance/lateness-rules', () => {
    it('empresa sin reglas: 200 con lista vacía y la regla por defecto de 3 por quincena', async () => {
      const response = await listRules().expect(200);

      expect(response.body).toEqual({
        items: [],
        default: { threshold: 3, period: 'FORTNIGHT' },
      });
    });

    it('no mezcla las reglas de otra empresa', async () => {
      await putRule('2026-11-16', { threshold: 2, period: 'WEEK' }, adminToken, otherCompanyId);

      expect(((await listRules()).body as RulesBody).items).toEqual([]);
    });

    it('empresa inexistente: 404 COMPANY_NOT_FOUND', async () => {
      const response = await listRules(adminToken, NO_COMPANY).expect(404);

      expect(response.body).toMatchObject({ code: 'COMPANY_NOT_FOUND' });
    });

    it('RH de otra empresa: 403; colaborador: 403; sin sesión: 401', async () => {
      await listRules(otherHrToken).expect(403);
      await listRules(anaToken).expect(403);
      await listRules(null).expect(401);
    });
  });

  describe('una falta por retardos vista por las rutas de jornadas', () => {
    beforeEach(async () => {
      // Lunes 2 a miércoles 4 de noviembre, los tres con retardo de 30 min.
      await push(lateDay('2026-11-02') + lateDay('2026-11-03') + lateDay('2026-11-04'));
    });

    it('con la regla por defecto, el tercer retardo de la quincena es ABSENT_LATENESS con sus minutos en la ruta de personal y en /me', async () => {
      await recalculate('2026-11-02', '2026-11-09');

      const staff = await staffWorkdays('2026-11-02', '2026-11-04');
      expect(staff.map((row) => [row.date, row.status, row.lateMinutes])).toEqual([
        ['2026-11-02', 'ATTENDED', 30],
        ['2026-11-03', 'ATTENDED', 30],
        ['2026-11-04', 'ABSENT_LATENESS', 30],
      ]);
      const mine = await call('get', '/me/attendance/workdays?month=2026-11', anaToken).expect(200);
      const mineByDate = new Map(
        (mine.body as { items: WorkdayBody[] }).items.map((row) => [row.date, row]),
      );
      expect(mineByDate.get('2026-11-04')).toMatchObject({
        status: 'ABSENT_LATENESS',
        lateMinutes: 30,
      });
      expect(mineByDate.get('2026-11-03')?.status).toBe('ATTENDED');
    });

    it('un retardo que llega a tiempo y se recalcula solo ese día devuelve la falta a ATTENDED', async () => {
      await recalculate('2026-11-02', '2026-11-09');
      await push(attlog(ana.rfc, '2026-11-02 08:55:00'));

      await recalculate('2026-11-02', '2026-11-02');

      const rows = await staffWorkdays('2026-11-02', '2026-11-04');
      expect(rows.map((row) => [row.date, row.status, row.lateMinutes])).toEqual([
        ['2026-11-02', 'ATTENDED', 0],
        ['2026-11-03', 'ATTENDED', 30],
        ['2026-11-04', 'ATTENDED', 30],
      ]);
    });

    it('una regla con vigencia hoy no cambia las jornadas anteriores ni al recalcularlas', async () => {
      await putRule(TODAY, { threshold: 1, period: 'WEEK' }).expect(204);

      await recalculate('2026-11-02', '2026-11-09');

      const rows = await staffWorkdays('2026-11-02', '2026-11-04');
      expect(rows.map((row) => row.status)).toEqual(['ATTENDED', 'ATTENDED', 'ABSENT_LATENESS']);
    });
  });
});
