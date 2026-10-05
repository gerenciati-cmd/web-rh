import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { RecordDevicePush } from '@/modules/attendance/application/commands/record-device-push.command';
import { FixedClock, RecordingLogger } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Detección de desfase de reloj (plan attendance-marcaciones/003) de punta a punta: alta por la
 * API, push por `/iclock` y lectura por `GET /attendance/devices`. El caso de uso del push se
 * reemplaza por uno con reloj fijo y logger de prueba (mismo patrón que `zkteco-adms.test.ts`),
 * así el desfase es determinista y el warn es observable.
 */
const SERIAL = 'TESTSN001';
/** 12:00:00 en America/Cancun (UTC-5). */
const RECEIVED_AT = new Date('2026-09-28T17:00:00Z');

const attlog = (...times: string[]) =>
  times.map((time) => `1\t${time}\t0\t1\t0\t0\t0\t0\t0\t0\t\n`).join('');

describe('desfase de reloj del checador (HTTP)', () => {
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let logger: RecordingLogger;

  const listDevices = async () =>
    (
      await request(app)
        .get(`${API_PREFIX}/attendance/devices`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200)
    ).body.items[0] as Record<string, unknown>;

  const push = (body: string) =>
    request(app)
      .post(`/iclock/cdata?SN=${SERIAL}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body)
      .expect(200);

  beforeEach(async () => {
    const container = buildTestContainer();
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    logger = new RecordingLogger();
    const { deviceRepository, punchRepository, idGenerator } = container.cradle;
    container.register({
      recordDevicePush: asValue(
        new RecordDevicePush({
          logger,
          deviceRepository,
          punchRepository,
          idGenerator,
          clock: new FixedClock(RECEIVED_AT),
        }),
      ),
    });
    app = createApp(container);
    await request(app)
      .post(`${API_PREFIX}/attendance/devices`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ serialNumber: SERIAL, name: 'Entrada', siteId })
      .expect(201);
  });

  it('antes de cualquier push el equipo no tiene medición', async () => {
    expect(await listDevices()).toMatchObject({
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
      clockSuspect: false,
    });
  });

  it('una marcación sellada con la hora local de la sede mide desfase ~0 y no es sospechosa', async () => {
    await push(attlog('2026-09-28 11:59:58'));

    const item = await listDevices();

    expect(item.clockOffsetSeconds).toBe(2);
    expect(item.clockOffsetMeasuredAt).toBe(RECEIVED_AT.toISOString());
    expect(item.clockSuspect).toBe(false);
    expect(logger.entries.some((entry) => entry.msg === 'zkteco: desfase de reloj')).toBe(false);
  });

  it('una marcación sellada una hora adelante mide -3600, es sospechosa y deja el warn', async () => {
    await push(attlog('2026-09-28 13:00:00'));

    const item = await listDevices();

    expect(item.clockOffsetSeconds).toBe(-3600);
    expect(item.clockSuspect).toBe(true);
    expect(logger.entries).toContainEqual({
      level: 'warn',
      obj: { serialNumber: SERIAL, offsetSeconds: -3600 },
      msg: 'zkteco: desfase de reloj',
    });
  });

  it.skip('NOT CONFIRMED: con el SenseFace 2A real, tras asignar su sede, una marcación real muestra un desfase pequeño (requiere el equipo físico)', () => {
    // Sin dispositivo no hay forma de ejercitarlo localmente (criterio 6 del plan).
  });

  it('un push de varias líneas (historial) deja el desfase como estaba', async () => {
    await push(attlog('2026-09-28 13:00:00'));

    await push(attlog('2026-09-27 08:00:00', '2026-09-27 09:00:00'));

    expect((await listDevices()).clockOffsetSeconds).toBe(-3600);
  });
});
