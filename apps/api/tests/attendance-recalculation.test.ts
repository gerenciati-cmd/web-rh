import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { wireSubscriptions } from '@/container';
import { API_PREFIX, createApp } from '@/http/app';
import type { RecalculateWorkdaysData } from '@/modules/attendance/application/jobs/recalculate-workdays.job';
import { attendanceModule } from '@/modules/attendance/attendance.module';
import { FixedClock, type RecordingJobQueue } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Recálculo automático de jornadas (plan attendance-asistencia-diaria/003): HTTP sobre el
 * contenedor real con persistencia en memoria y `RecordingJobQueue`. Cada disparador (marcación
 * por /iclock, asignación de turno, baja) debe encolar el job correcto; correr el job grabado por
 * su handler es lo que haría el worker, y actualiza `GET …/workdays`. Reloj fijo: hoy = 2026-10-14.
 */
const TODAY = '2026-10-14';
const RECALCULATE = 'attendance.recalculate-workdays';
const device = { serialNumber: 'AUTOSN01', name: 'Entrada' };

// Un día de trabajo por ciclo: todas las fechas son laborables (el 5 de octubre de 2026 es lunes).
const dailyShift = {
  name: 'Diario',
  cycleStartDate: '2026-10-05',
  toleranceMinutes: 10,
  days: [{ type: 'WORK', start: '09:00', end: '18:00', mealBreakMinutes: 60 }],
};

const ana = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};
// Sin RFC: sus marcaciones no se pueden atribuir y no se puede recalcular.
const pedro = {
  nationalId: { country: 'DO', number: '00113918205' },
  firstName: 'Pedro',
  lastName: 'Araya',
  email: 'pedro@aps.example',
  hireDate: '2026-01-10',
};

const attlog = (pin: string, time: string) => `${pin}\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`;

interface WorkdayBody {
  date: string;
  status: string;
  punchCount: number;
}

describe('Recálculo automático de jornadas (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let queue: RecordingJobQueue;
  let adminToken: string;
  let hrToken: string;
  let companyId: string;
  let siteId: string;
  let anaId: string;
  let shiftId: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const workdaysOf = async (from: string, to: string): Promise<WorkdayBody[]> => {
    const response = await call(
      'get',
      `/companies/${companyId}/attendance/employees/${anaId}/workdays?from=${from}&to=${to}`,
      hrToken,
    ).expect(200);
    return (response.body as { items: WorkdayBody[] }).items;
  };
  const assign = (effectiveFrom: string) =>
    call(
      'put',
      `/companies/${companyId}/attendance/employees/${anaId}/shift-assignments/${effectiveFrom}`,
      adminToken,
    ).send({ shiftId });
  const terminate = (terminationDate: string) =>
    call('post', `/companies/${companyId}/employees/${anaId}/termination`, adminToken).send({
      terminationDate,
      reason: 'END_OF_CONTRACT',
    });
  const push = (body: string) =>
    request(app)
      .post(`/iclock/cdata?SN=${device.serialNumber}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body);
  const recalculationJobs = () => queue.jobs.filter((job) => job.name === RECALCULATE);
  const dataOf = (job: { data: object }) => job.data as RecalculateWorkdaysData;
  /** Lo que haría el worker: ejecuta los jobs de recálculo grabados y vacía lo grabado. */
  async function runRecordedJobs(): Promise<void> {
    const pending = recalculationJobs();
    queue.jobs.length = 0;
    for (const job of pending) await container.cradle.recalculateWorkdaysJob.handle(dataOf(job));
  }

  beforeEach(async () => {
    container = buildTestContainer();
    container.register({ clock: asValue(new FixedClock(new Date(`${TODAY}T12:00:00Z`))) });
    wireSubscriptions(container);
    app = createApp(container);
    queue = container.cradle.jobQueue as RecordingJobQueue;
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteId = await createTestSite(container);
    const company = await call('post', '/companies', adminToken)
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyId = (company.body as { id: string }).id;
    hrToken = await signInAs(container, { role: 'HR', companyId });
    const hired = await call('post', `/companies/${companyId}/employees`, adminToken)
      .send({ siteId, ...ana })
      .expect(201);
    anaId = (hired.body as { id: string }).id;
    await call('post', '/attendance/devices', adminToken)
      .send({ ...device, siteId })
      .expect(201);
    const shift = await call('post', `/companies/${companyId}/attendance/shifts`, adminToken)
      .send(dailyShift)
      .expect(201);
    shiftId = (shift.body as { id: string }).id;
    queue.jobs.length = 0;
  });

  describe('declaración del módulo (lo que consume el worker)', () => {
    it('registra los dos handlers y programa el cierre horario con un handler del mismo nombre', () => {
      const handlerNames = (attendanceModule.jobs?.(container.cradle) ?? []).map(
        (handler) => handler.name,
      );

      expect(handlerNames).toEqual([
        'attendance.recalculate-workdays',
        'attendance.close-workdays',
      ]);
      expect(attendanceModule.schedules).toEqual([
        { name: 'attendance.close-workdays', pattern: '5 * * * *', timeZone: 'America/Cancun' },
      ]);
      for (const schedule of attendanceModule.schedules ?? []) {
        expect(handlerNames).toContain(schedule.name);
      }
    });
  });

  describe('marcaciones', () => {
    it('una marcación nueva encola el recálculo por PIN y el job actualiza las jornadas sin llamar al endpoint', async () => {
      await assign('2026-10-05').expect(204);
      queue.jobs.length = 0;

      await push(
        attlog(ana.rfc, '2026-10-12 08:00:00') + attlog(ana.rfc, '2026-10-12 18:00:00'),
      ).expect(200);

      expect(recalculationJobs()).toHaveLength(1);
      expect(dataOf(recalculationJobs()[0] ?? { data: {} })).toEqual({
        pin: ana.rfc,
        from: '2026-10-11',
        to: '2026-10-12',
      });
      expect(await workdaysOf('2026-10-05', '2026-10-13')).toEqual([]);

      await runRecordedJobs();

      const rows = await workdaysOf('2026-10-11', '2026-10-12');
      expect(rows.map((row) => [row.date, row.status, row.punchCount])).toEqual([
        ['2026-10-11', 'ABSENT_NO_PUNCHES', 0],
        ['2026-10-12', 'ATTENDED', 2],
      ]);
    });

    it('reenviar las mismas líneas (todas duplicadas) no encola nada', async () => {
      const lines = attlog(ana.rfc, '2026-10-12 08:00:00') + attlog(ana.rfc, '2026-10-12 18:00:00');
      await push(lines).expect(200);
      queue.jobs.length = 0;

      await push(lines).expect(200);

      expect(queue.jobs).toEqual([]);
    });

    it('un PIN sin colaborador encola igual y el job termina sin recalcular ni lanzar', async () => {
      await push(attlog('DESCONOCIDO99', '2026-10-12 08:00:00')).expect(200);

      expect(recalculationJobs().map(dataOf)).toEqual([
        { pin: 'DESCONOCIDO99', from: '2026-10-11', to: '2026-10-12' },
      ]);
      await expect(runRecordedJobs()).resolves.toBeUndefined();
    });
  });

  describe('asignación de turno', () => {
    it('una fecha pasada encola el recálculo de esa fecha a hoy', async () => {
      await assign('2026-10-05').expect(204);

      expect(recalculationJobs().map(dataOf)).toEqual([
        { employeeId: anaId, from: '2026-10-05', to: TODAY },
      ]);
    });

    it('al correr el job aparecen las jornadas del turno nuevo', async () => {
      await push(
        attlog(ana.rfc, '2026-10-06 08:50:00') + attlog(ana.rfc, '2026-10-06 18:00:00'),
      ).expect(200);
      await assign('2026-10-05').expect(204);

      await runRecordedJobs();

      const rows = await workdaysOf('2026-10-05', '2026-10-07');
      expect(rows.map((row) => [row.date, row.status])).toEqual([
        ['2026-10-05', 'ABSENT_NO_PUNCHES'],
        ['2026-10-06', 'ATTENDED'],
        ['2026-10-07', 'ABSENT_NO_PUNCHES'],
      ]);
    });

    it('una fecha futura asigna sin encolar nada', async () => {
      await assign('2026-11-02').expect(204);

      expect(queue.jobs).toEqual([]);
    });

    it('una asignación rechazada (turno inexistente) no encola nada', async () => {
      await call(
        'put',
        `/companies/${companyId}/attendance/employees/${anaId}/shift-assignments/2026-10-05`,
        adminToken,
      )
        .send({ shiftId: '00000000-0000-4000-8000-00000000beef' })
        .expect(404);

      expect(queue.jobs).toEqual([]);
    });
  });

  describe('baja del colaborador', () => {
    it('encola el recálculo de la fecha de baja a hoy y el job borra las jornadas posteriores', async () => {
      await assign('2026-10-05').expect(204);
      await runRecordedJobs();
      expect((await workdaysOf('2026-10-05', '2026-10-13')).map((row) => row.date)).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
        '2026-10-09',
        '2026-10-10',
        '2026-10-11',
        '2026-10-12',
        '2026-10-13',
      ]);

      await terminate('2026-10-08').expect(204);

      expect(recalculationJobs().map(dataOf)).toEqual([
        { employeeId: anaId, from: '2026-10-08', to: TODAY },
      ]);

      await runRecordedJobs();

      expect((await workdaysOf('2026-10-05', '2026-10-13')).map((row) => row.date)).toEqual([
        '2026-10-05',
        '2026-10-06',
        '2026-10-07',
        '2026-10-08',
      ]);
    });
  });

  describe('cierre horario', () => {
    it('encola un recálculo por colaborador con turno y las faltas aparecen sin que nadie las pida', async () => {
      await assign('2026-10-05').expect(204);
      queue.jobs.length = 0;

      await container.cradle.closeWorkdaysJob.handle();

      expect(recalculationJobs().map(dataOf)).toEqual([
        { employeeId: anaId, from: '2026-10-12', to: TODAY },
      ]);

      await runRecordedJobs();

      const rows = await workdaysOf('2026-10-12', '2026-10-13');
      expect(rows.map((row) => [row.date, row.status])).toEqual([
        ['2026-10-12', 'ABSENT_NO_PUNCHES'],
        ['2026-10-13', 'ABSENT_NO_PUNCHES'],
      ]);
    });

    it('omite al colaborador dado de baja antes del rango del cierre', async () => {
      await assign('2026-10-05').expect(204);
      await terminate('2026-10-09').expect(204);
      queue.jobs.length = 0;

      await container.cradle.closeWorkdaysJob.handle();

      expect(queue.jobs).toEqual([]);
    });
  });

  describe('colaborador que no se puede recalcular', () => {
    it('el job de un colaborador sin RFC termina sin lanzar (sin reintento) y no guarda jornadas', async () => {
      const hired = await call('post', `/companies/${companyId}/employees`, adminToken)
        .send({ siteId, ...pedro })
        .expect(201);
      const pedroId = (hired.body as { id: string }).id;

      await expect(
        container.cradle.recalculateWorkdaysJob.handle({
          employeeId: pedroId,
          from: '2026-10-12',
          to: TODAY,
        }),
      ).resolves.toBeUndefined();

      const stored = await call(
        'get',
        `/companies/${companyId}/attendance/employees/${pedroId}/workdays?from=2026-10-12&to=${TODAY}`,
        hrToken,
      ).expect(200);
      expect((stored.body as { items: unknown[] }).items).toEqual([]);
    });
  });
});
