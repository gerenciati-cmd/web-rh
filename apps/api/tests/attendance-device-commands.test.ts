import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { RecordDeviceContact } from '@/modules/attendance/application/commands/record-device-contact.command';
import { FixedClock, RecordingLogger } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Sonda de comandos ADMS (plan attendance-marcaciones/004): encolado por la API y entrega por
 * `/iclock/getrequest`, sobre el contenedor real con persistencia en memoria. El log de contacto
 * se captura reemplazando `recordDeviceContact` por una instancia con `RecordingLogger` (el logger
 * de pino-http del cradle no es sustituible, ver `zkteco-adms.test.ts`).
 */
const SERIAL = 'TESTSN001';
const USER_COMMAND = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';

describe('sonda de comandos ADMS (HTTP)', () => {
  let app: ReturnType<typeof createApp>;
  let container: ReturnType<typeof buildTestContainer>;
  let logger: RecordingLogger;
  let clock: FixedClock;
  let adminToken: string;
  let hrToken: string;
  let deviceId: string;

  const api = (token: string | null) => ({
    get: (path: string) => withAuth(request(app).get(`${API_PREFIX}${path}`), token),
    post: (path: string) => withAuth(request(app).post(`${API_PREFIX}${path}`), token),
  });

  function withAuth<T extends request.Test>(test: T, token: string | null): T {
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  }

  function queue(command: string, id = deviceId, token: string | null = adminToken) {
    return api(token).post(`/attendance/devices/${id}/commands`).send({ command });
  }

  beforeEach(async () => {
    container = buildTestContainer();
    logger = new RecordingLogger();
    clock = new FixedClock();
    const { deviceRepository } = container.cradle;
    container.register({
      clock: asValue(clock),
      recordDeviceContact: asValue(new RecordDeviceContact({ logger, deviceRepository, clock })),
    });
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    const siteId = await createTestSite(container);
    const device = await api(adminToken)
      .post('/attendance/devices')
      .send({ serialNumber: SERIAL, name: 'Entrada', siteId })
      .expect(201);
    deviceId = device.body.id as string;
    // Solo un equipo con redes permitidas recibe comandos (plan 008); supertest llega por loopback.
    await withAuth(
      request(app).put(`${API_PREFIX}/attendance/devices/${deviceId}/networks`),
      adminToken,
    )
      .send({ allowedNetworks: ['127.0.0.1'] })
      .expect(204);
    const company = await api(adminToken)
      .post('/companies')
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    hrToken = await signInAs(container, { role: 'HR', companyId: company.body.id as string });
  });

  describe('POST /attendance/devices/:deviceId/commands', () => {
    it('HOLDING_ADMIN encola un comando USERINFO: 201 con el id', async () => {
      const response = await queue(USER_COMMAND).expect(201);

      expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it.each([
      'CLEAR DATA',
      'REBOOT',
      'DATA UPDATE BIODATA Pin=1',
      // Reparación L2 de la revisión (plan 006, 2026-10-06): el prefijo C:<n>: lo asigna el API;
      // escrito a mano se rechaza. Antes solo lo probaban las capas de contrato y dominio.
      'C:9:DATA QUERY USERINFO PIN=X',
    ])('el comando %j: 400 VALIDATION_ERROR', async (command) => {
      const response = await queue(command).expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('sin command: 400 VALIDATION_ERROR; deviceId que no es UUID: 400', async () => {
      const empty = await api(adminToken)
        .post(`/attendance/devices/${deviceId}/commands`)
        .send({})
        .expect(400);
      const badId = await queue(USER_COMMAND, 'no-uuid').expect(400);

      expect(empty.body.code).toBe('VALIDATION_ERROR');
      expect(badId.body.code).toBe('VALIDATION_ERROR');
    });

    it('equipo inexistente: 404 DEVICE_NOT_FOUND', async () => {
      const response = await queue(USER_COMMAND, '00000000-0000-4000-8000-0000000000ff').expect(
        404,
      );

      expect(response.body.code).toBe('DEVICE_NOT_FOUND');
    });

    it('HR: 403 FORBIDDEN; sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const forbidden = await queue(USER_COMMAND, deviceId, hrToken).expect(403);
      const anonymous = await queue(USER_COMMAND, deviceId, null).expect(401);

      expect(forbidden.body.code).toBe('FORBIDDEN');
      expect(anonymous.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('un comando rechazado no queda en la bitácora', async () => {
      await queue('CLEAR DATA').expect(400);

      const list = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      expect(list.body.total).toBe(0);
    });
  });

  describe('entrega por GET /iclock/getrequest', () => {
    it('el siguiente sondeo responde exactamente el texto encolado y el posterior OK', async () => {
      await queue(USER_COMMAND).expect(201);

      const first = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);
      const second = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);

      expect(first.text).toBe(`C:1:${USER_COMMAND}`);
      expect(second.text).toBe('OK');
    });

    it('sin comandos encolados responde OK', async () => {
      const response = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);

      expect(response.text).toBe('OK');
    });

    it('entrega los comandos del más antiguo al más nuevo, uno por sondeo', async () => {
      await queue('DATA QUERY USERINFO PIN=1').expect(201);
      await queue('DATA QUERY USERINFO PIN=2').expect(201);

      const polls = [];
      for (let i = 0; i < 3; i += 1) {
        polls.push((await request(app).get(`/iclock/getrequest?SN=${SERIAL}`)).text);
      }

      expect(polls).toEqual([
        'C:1:DATA QUERY USERINFO PIN=1',
        'C:2:DATA QUERY USERINFO PIN=2',
        'OK',
      ]);
    });

    it('un equipo no registrado no recibe comandos de otro y se le niega', async () => {
      await queue(USER_COMMAND).expect(201);

      const response = await request(app).get('/iclock/getrequest?SN=OTRO');

      expect(response.text).not.toContain('USERINFO');
      const still = await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);
      expect(still.text).toBe(`C:1:${USER_COMMAND}`);
    });
  });

  describe('GET /attendance/devices/:deviceId/commands', () => {
    it('muestra el comando QUEUED y, tras el sondeo, SENT con sentAt', async () => {
      const created = await queue(USER_COMMAND).expect(201);

      const before = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      expect(before.body.items).toEqual([
        expect.objectContaining({
          id: created.body.id,
          command: USER_COMMAND,
          status: 'QUEUED',
          sentAt: null,
        }),
      ]);
      expect(before.body.items[0].queuedBy).toMatch(/^[0-9a-f-]{36}$/);

      await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);

      const after = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      expect(after.body.items[0].status).toBe('SENT');
      expect(typeof after.body.items[0].sentAt).toBe('string');
      expect(after.body.total).toBe(1);
    });

    it('lista el más nuevo primero y pagina', async () => {
      // Segundos después del reloj inicial: las sesiones del test siguen vigentes.
      clock.set(new Date('2026-01-15T12:00:05Z'));
      await queue('DATA QUERY USERINFO PIN=1').expect(201);
      clock.set(new Date('2026-01-15T12:00:06Z'));
      await queue('DATA QUERY USERINFO PIN=2').expect(201);

      const page = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands?page=1&pageSize=1`)
        .expect(200);

      expect(page.body.total).toBe(2);
      const items = (page.body as { items: { command: string }[] }).items;
      expect(items.map((item) => item.command)).toEqual(['DATA QUERY USERINFO PIN=2']);
    });

    it('equipo inexistente: 404 DEVICE_NOT_FOUND', async () => {
      const response = await api(adminToken)
        .get('/attendance/devices/00000000-0000-4000-8000-0000000000ff/commands')
        .expect(404);

      expect(response.body.code).toBe('DEVICE_NOT_FOUND');
    });

    it('HR: 403 FORBIDDEN; sin sesión: 401', async () => {
      const forbidden = await api(hrToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(403);
      await api(null).get(`/attendance/devices/${deviceId}/commands`).expect(401);

      expect(forbidden.body.code).toBe('FORBIDDEN');
    });
  });

  describe('POST /iclock/devicecmd', () => {
    it('responde OK y registra ID, Return y CMD con el resto redactado', async () => {
      const response = await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send('ID=1&Return=0&CMD=DATA&Name=Ana Rojas');

      expect(response.status).toBe(200);
      expect(response.text).toBe('OK');
      expect(logger.entries).toContainEqual({
        level: 'info',
        obj: {
          serialNumber: SERIAL,
          fields: { ID: '1', Return: '0', CMD: 'DATA', Name: '[redactado:9]' },
        },
        msg: 'zkteco: resultado de comando',
      });
      expect(JSON.stringify(logger.entries)).not.toContain('Ana Rojas');
    });

    // Plan 006 (hallazgo L3 del 004): cada línea es un resultado propio.
    it('registra un resultado por línea', async () => {
      await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send('ID=2&Return=-1&CMD=DATA\nID=3&Return=0&CMD=DATA')
        .expect(200);

      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          msg: 'zkteco: resultado de comando',
          obj: { serialNumber: SERIAL, fields: { ID: '2', Return: '-1', CMD: 'DATA' } },
        }),
      );
      expect(logger.entries).toContainEqual(
        expect.objectContaining({
          msg: 'zkteco: resultado de comando',
          obj: { serialNumber: SERIAL, fields: { ID: '3', Return: '0', CMD: 'DATA' } },
        }),
      );
    });

    /**
     * AC3/AC4 del plan 006: `devicecmd` también cierra el comando que `ID` identifica
     * (`CompleteDeviceCommands`), aparte del log de contacto de arriba. Se observa a través de la
     * bitácora, no del log: `completeDeviceCommands` usa el logger/clock reales del contenedor,
     * que este archivo no reemplaza.
     */
    async function queuedAndSent(command: string): Promise<{ id: string; number: number }> {
      const created = await queue(command).expect(201);
      const listBefore = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      const before = (listBefore.body as { items: { id: string; number: number }[] }).items.find(
        (item) => item.id === created.body.id,
      );
      if (!before) throw new Error('comando recién encolado no aparece en la bitácora');
      await request(app).get(`/iclock/getrequest?SN=${SERIAL}`).expect(200);
      return { id: created.body.id as string, number: before.number };
    }

    async function commandInLog(id: string) {
      const list = await api(adminToken)
        .get(`/attendance/devices/${deviceId}/commands`)
        .expect(200);
      const items = list.body.items as {
        id: string;
        status: string;
        returnCode: string | null;
        completedAt: string | null;
      }[];
      const found = items.find((item) => item.id === id);
      if (!found) throw new Error(`comando ${id} no aparece en la bitácora`);
      return found;
    }

    it('Return=0 deja el comando DONE con returnCode y completedAt en la bitácora', async () => {
      const { id, number } = await queuedAndSent('DATA QUERY USERINFO PIN=1');

      await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send(`ID=${number}&Return=0&CMD=DATA`)
        .expect(200);

      const found = await commandInLog(id);
      expect(found.status).toBe('DONE');
      expect(found.returnCode).toBe('0');
      expect(typeof found.completedAt).toBe('string');
    });

    it('un Return distinto de 0 en otro comando lo deja FAILED', async () => {
      const first = await queuedAndSent('DATA QUERY USERINFO PIN=1');
      const second = await queuedAndSent('DATA QUERY USERINFO PIN=2');

      await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send(`ID=${second.number}&Return=-1&CMD=DATA`)
        .expect(200);

      expect((await commandInLog(second.id)).status).toBe('FAILED');
      // El otro comando, sin resultado todavía, sigue SENT.
      expect((await commandInLog(first.id)).status).toBe('SENT');
    });

    it('un ID desconocido responde OK y no cambia ningún comando de la bitácora', async () => {
      const { id } = await queuedAndSent('DATA QUERY USERINFO PIN=1');

      const response = await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send('ID=999999&Return=0&CMD=DATA')
        .expect(200);

      expect(response.text).toBe('OK');
      expect((await commandInLog(id)).status).toBe('SENT');
    });

    it('un cuerpo con dos líneas cierra cada comando de su propia línea', async () => {
      const a = await queuedAndSent('DATA QUERY USERINFO PIN=1');
      const b = await queuedAndSent('DATA QUERY USERINFO PIN=2');

      await request(app)
        .post(`/iclock/devicecmd?SN=${SERIAL}`)
        .set('Content-Type', 'text/plain')
        .send(`ID=${a.number}&Return=0&CMD=DATA\nID=${b.number}&Return=-2&CMD=DATA`)
        .expect(200);

      expect((await commandInLog(a.id)).status).toBe('DONE');
      expect((await commandInLog(b.id)).status).toBe('FAILED');
    });
  });

  describe('OpenAPI', () => {
    it('publica las dos rutas de la bitácora de comandos', async () => {
      const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);
      const paths = response.body.paths as Record<string, Record<string, unknown>>;

      expect(Object.keys(paths['/attendance/devices/{deviceId}/commands'] ?? {}).sort()).toEqual([
        'get',
        'post',
      ]);
    });
  });
});
