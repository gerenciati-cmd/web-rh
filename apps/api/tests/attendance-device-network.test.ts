import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from '@/config/env';
import { API_PREFIX, createApp } from '@/http/app';
import { RecordDeviceContact } from '@/modules/attendance/application/commands/record-device-contact.command';
import { RecordDevicePush } from '@/modules/attendance/application/commands/record-device-push.command';
import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs, testEnv } from './test-app';

/**
 * Barrera de red por checador (plan attendance-marcaciones/005) sobre el contenedor real con
 * persistencia en memoria: la ruta `PUT .../networks`, el rechazo de `/iclock` por IP de origen y
 * `TRUST_PROXY`. supertest llega por loopback, así que `req.ip` es `::ffff:127.0.0.1`.
 */
const SERIAL = 'TESTSN001';
const NOT_ALLOWED = 'ERROR: dispositivo no autorizado';
const USER_COMMAND = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';
const ATTLOG = '1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n';

describe('barrera de red de los checadores (HTTP)', () => {
  let app: ReturnType<typeof createApp>;
  let container: ReturnType<typeof buildTestContainer>;
  let logger: RecordingLogger;
  let adminToken: string;
  let hrToken: string;
  let deviceId: string;

  const api = (token: string | null) => ({
    get: (path: string) => withAuth(request(app).get(`${API_PREFIX}${path}`), token),
    post: (path: string) => withAuth(request(app).post(`${API_PREFIX}${path}`), token),
    put: (path: string) => withAuth(request(app).put(`${API_PREFIX}${path}`), token),
  });

  function withAuth<T extends request.Test>(test: T, token: string | null): T {
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  }

  const setNetworks = (networks: unknown, id = deviceId, token: string | null = adminToken) =>
    api(token).put(`/attendance/devices/${id}/networks`).send({ allowedNetworks: networks });

  const attlog = () =>
    request(app).post(`/iclock/cdata?SN=${SERIAL}&table=ATTLOG`).set('Content-Type', 'text/plain');

  async function listedDevice() {
    const list = await api(adminToken).get('/attendance/devices').expect(200);
    return (list.body as { items: Record<string, unknown>[] }).items[0];
  }

  /** Reemplaza los casos de uso de /iclock por instancias con el logger de prueba. */
  function captureLogs(target: typeof container) {
    logger = new RecordingLogger();
    const clock = new FixedClock();
    const { deviceRepository, punchRepository } = target.cradle;
    target.register({
      recordDeviceContact: asValue(new RecordDeviceContact({ logger, deviceRepository, clock })),
      recordDevicePush: asValue(
        new RecordDevicePush({
          logger,
          deviceRepository,
          punchRepository,
          idGenerator: new SequentialIdGenerator(),
          clock,
        }),
      ),
    });
  }

  async function setUp(env = testEnv) {
    container = buildTestContainer(env);
    captureLogs(container);
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    const created = await api(adminToken)
      .post('/attendance/devices')
      .send({ serialNumber: SERIAL, name: 'Entrada', siteId })
      .expect(201);
    deviceId = created.body.id as string;
    const company = await api(adminToken)
      .post('/companies')
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    hrToken = await signInAs(container, { role: 'HR', companyId: company.body.id as string });
  }

  beforeEach(async () => {
    await setUp();
  });

  describe('PUT /attendance/devices/:deviceId/networks', () => {
    it('HOLDING_ADMIN: 204 y la lista muestra las redes en forma canónica', async () => {
      await setNetworks(['127.0.0.1', '10.1.2.3/24']).expect(204);

      expect((await listedDevice())?.allowedNetworks).toEqual(['127.0.0.1/32', '10.1.2.0/24']);
    });

    it('la lista vacía quita la restricción: 204', async () => {
      await setNetworks(['127.0.0.1']).expect(204);
      await setNetworks([]).expect(204);

      expect((await listedDevice())?.allowedNetworks).toEqual([]);
    });

    it('HR: 403 FORBIDDEN; sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const forbidden = await setNetworks(['127.0.0.1'], deviceId, hrToken).expect(403);
      const anonymous = await setNetworks(['127.0.0.1'], deviceId, null).expect(401);

      expect(forbidden.body.code).toBe('FORBIDDEN');
      expect(anonymous.body.code).toBe('AUTHENTICATION_REQUIRED');
      expect((await listedDevice())?.allowedNetworks).toEqual([]);
    });

    it('equipo inexistente: 404 DEVICE_NOT_FOUND', async () => {
      const response = await setNetworks(
        ['127.0.0.1'],
        '00000000-0000-4000-8000-0000000000ff',
      ).expect(404);

      expect(response.body.code).toBe('DEVICE_NOT_FOUND');
    });

    it.each([
      ['prefijo fuera de rango', ['10.0.0.0/33']],
      ['IPv6', ['::1']],
      ['IPv6 con prefijo', ['2001:db8::/32']],
      ['texto basura', ['junk']],
      ['una válida y una inválida', ['127.0.0.1', '999.1.1.1']],
      ['más de 10 redes', Array.from({ length: 11 }, (_, index) => `10.0.${index}.0/24`)],
      ['no es lista', '127.0.0.1'],
      ['falta el campo', undefined],
    ])('%s: 400 VALIDATION_ERROR y no cambia nada', async (_name, networks) => {
      await setNetworks(['127.0.0.1']).expect(204);

      const response = await setNetworks(networks).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect((await listedDevice())?.allowedNetworks).toEqual(['127.0.0.1/32']);
    });

    it('deviceId que no es UUID: 400 VALIDATION_ERROR', async () => {
      const response = await setNetworks(['127.0.0.1'], 'no-uuid').expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /attendance/devices: allowedNetworks y lastSeenIp', () => {
    it('un equipo recién registrado: allowedNetworks [] y lastSeenIp null', async () => {
      const device = await listedDevice();

      expect(device?.allowedNetworks).toEqual([]);
      expect(device?.lastSeenIp).toBeNull();
    });

    it('tras un contacto por /iclock muestra la IP de origen del último contacto', async () => {
      await request(app).get(`/iclock/cdata?SN=${SERIAL}`).expect(200);

      expect((await listedDevice())?.lastSeenIp).toBe('127.0.0.1');
    });
  });

  describe('flujo del administrador: aprender la IP desde lastSeenIp', () => {
    // `req.ip` llega como `::ffff:a.b.c.d` en sockets de doble pila; se guarda normalizada para que
    // la IP mostrada se pueda pegar tal cual en `PUT .../networks` (`z.ipv4()`).
    it('la IP mostrada en lastSeenIp se puede enviar tal cual a PUT .../networks', async () => {
      await request(app).get(`/iclock/cdata?SN=${SERIAL}`).expect(200);
      const shown = (await listedDevice())?.lastSeenIp;

      await setNetworks([shown]).expect(204);
    });
  });

  describe('/iclock con redes que excluyen al llamador', () => {
    beforeEach(async () => {
      await setNetworks(['10.9.9.0/24']).expect(204);
      logger.entries.length = 0;
    });

    it('GET /iclock/cdata: 403 con el mismo texto que un equipo desconocido', async () => {
      const blocked = await request(app).get(`/iclock/cdata?SN=${SERIAL}`);
      const unknown = await request(app).get('/iclock/cdata?SN=NOEXISTE');

      expect(blocked.status).toBe(403);
      expect(blocked.text).toBe(NOT_ALLOWED);
      expect(unknown.status).toBe(403);
      expect(unknown.text).toBe(blocked.text);
    });

    it('GET /iclock/getrequest: 403 y no se entrega ningún comando', async () => {
      const response = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`);

      expect(response.status).toBe(403);
      expect(response.text).toBe(NOT_ALLOWED);
    });

    it('POST /iclock/cdata ATTLOG: 403 y no se guarda ninguna marcación', async () => {
      const response = await attlog().send(ATTLOG);

      expect(response.status).toBe(403);
      expect(response.text).toBe(NOT_ALLOWED);
      const punches = await api(adminToken).get('/attendance/punches').expect(200);
      expect(punches.body.total).toBe(0);
    });

    it('registra `zkteco: IP no permitida` con el serial y la IP de origen', async () => {
      await request(app).get(`/iclock/cdata?SN=${SERIAL}`).expect(403);

      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          level: 'warn',
          msg: 'zkteco: IP no permitida',
          obj: expect.objectContaining({
            serialNumber: SERIAL,
            sourceIp: '::ffff:127.0.0.1',
          }),
        }),
      );
    });

    it('un rechazo no actualiza lastSeenIp', async () => {
      await request(app).get(`/iclock/cdata?SN=${SERIAL}`).expect(403);

      expect((await listedDevice())?.lastSeenIp).toBeNull();
    });
  });

  describe('/iclock con redes que incluyen al llamador', () => {
    beforeEach(async () => {
      await setNetworks(['127.0.0.1']).expect(204);
    });

    it('handshake, getrequest y ATTLOG funcionan como antes', async () => {
      const handshake = await request(app).get(`/iclock/cdata?SN=${SERIAL}&options=all`);
      const poll = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`);
      const push = await attlog().send(ATTLOG);

      expect(handshake.status).toBe(200);
      expect(poll.status).toBe(200);
      expect(poll.text).toBe('OK');
      expect(push.status).toBe(200);
      expect(push.text).toBe('OK: 1');
      const punches = await api(adminToken).get('/attendance/punches').expect(200);
      expect(punches.body.total).toBe(1);
    });
  });

  describe('equipo sin redes permitidas', () => {
    it('sigue recibiendo marcaciones desde cualquier IP', async () => {
      const push = await attlog().send(ATTLOG);

      expect(push.status).toBe(200);
      const punches = await api(adminToken).get('/attendance/punches').expect(200);
      expect(punches.body.total).toBe(1);
    });

    it('POST .../commands: 422 DEVICE_NETWORK_UNRESTRICTED y nada queda en la bitácora', async () => {
      const response = await api(adminToken)
        .post(`/attendance/devices/${deviceId}/commands`)
        .send({ command: USER_COMMAND })
        .expect(422);

      expect(response.body.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
      expect(response.body.details).toEqual({ deviceId });
      const list = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      expect(list.body.total).toBe(0);
    });

    it('un comando encolado cuando había redes no se entrega al vaciar la lista y sigue QUEUED', async () => {
      await setNetworks(['127.0.0.1']).expect(204);
      await api(adminToken)
        .post(`/attendance/devices/${deviceId}/commands`)
        .send({ command: USER_COMMAND })
        .expect(201);
      await setNetworks([]).expect(204);

      const poll = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);

      expect(poll.text).toBe('OK');
      const list = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      expect(list.body.items[0].status).toBe('QUEUED');
      expect(list.body.items[0].sentAt).toBeNull();
    });
  });

  describe('TRUST_PROXY', () => {
    const envWith = (trustProxy: string | undefined) =>
      loadEnv({
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
        ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
      });

    it('con TRUST_PROXY=1, X-Forwarded-For se evalúa como la IP del equipo', async () => {
      await setUp(envWith('1'));
      await setNetworks(['10.9.9.0/24']).expect(204);

      const allowed = await request(app)
        .get(`/iclock/cdata?SN=${SERIAL}`)
        .set('X-Forwarded-For', '10.9.9.5');
      const blocked = await request(app)
        .get(`/iclock/cdata?SN=${SERIAL}`)
        .set('X-Forwarded-For', '203.0.113.7');

      expect(allowed.status).toBe(200);
      expect(blocked.status).toBe(403);
      expect((await listedDevice())?.lastSeenIp).toBe('10.9.9.5');
    });

    it.each([undefined, ''])(
      'sin TRUST_PROXY (%j) X-Forwarded-For se ignora: manda la IP del socket',
      async (value) => {
        await setUp(envWith(value));
        await setNetworks(['10.9.9.0/24']).expect(204);

        const spoofed = await request(app)
          .get(`/iclock/cdata?SN=${SERIAL}`)
          .set('X-Forwarded-For', '10.9.9.5');

        expect(spoofed.status).toBe(403);
        expect(spoofed.text).toBe(NOT_ALLOWED);
      },
    );

    it('con TRUST_PROXY=1 y una IP permitida solo por el socket, el header gana', async () => {
      await setUp(envWith('1'));
      await setNetworks(['127.0.0.1']).expect(204);

      const response = await request(app)
        .get(`/iclock/cdata?SN=${SERIAL}`)
        .set('X-Forwarded-For', '203.0.113.7');

      expect(response.status).toBe(403);
    });
  });
});
