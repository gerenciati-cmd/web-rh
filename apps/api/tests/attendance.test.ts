import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { API_PREFIX, createApp } from '@/http/app';
import { Device, type DeviceId } from '@/modules/attendance/domain/device';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Rutas `/api/v1/attendance/*` y su integración con `/iclock` (plan attendance-marcaciones/001),
 * sobre el contenedor real con persistencia en memoria. El alta se hace por la API y el empuje
 * por el router ADMS, así que el registro, la autorización del equipo y el listado se prueban
 * encadenados.
 */
const device = { serialNumber: 'TESTSN001', name: 'Entrada principal', siteId: '' };

const TWO_PUNCHES =
  '1\t2026-09-28 08:01:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n' +
  '2\t2026-09-28 12:17:29\t0\t15\t0\t0\t0\t0\t0\t0\t\n';

/** Extrae un campo de cada elemento de una página (el body de supertest es `any`). */
function field(response: request.Response, key: string): unknown[] {
  const items = (response.body as { items: Record<string, unknown>[] }).items;
  return items.map((item) => item[key]);
}

describe('attendance HTTP', () => {
  let app: ReturnType<typeof createApp>;
  let container: ReturnType<typeof buildTestContainer>;
  let adminToken: string;
  let hrToken: string;
  let noRoleToken: string;

  const api = (token: string | null) => ({
    get: (path: string) => withAuth(request(app).get(`${API_PREFIX}${path}`), token),
    post: (path: string) => withAuth(request(app).post(`${API_PREFIX}${path}`), token),
    put: (path: string) => withAuth(request(app).put(`${API_PREFIX}${path}`), token),
  });

  function withAuth<T extends request.Test>(test: T, token: string | null): T {
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  }

  async function registerDevice(body: object = device): Promise<string> {
    const response = await api(adminToken).post('/attendance/devices').send(body).expect(201);
    return response.body.id as string;
  }

  function pushAttlog(serial = device.serialNumber, body = TWO_PUNCHES) {
    return request(app)
      .post(`/iclock/cdata?SN=${serial}&table=ATTLOG`)
      .set('Content-Type', 'text/plain')
      .send(body);
  }

  beforeEach(async () => {
    container = buildTestContainer();
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    // La sede da la zona horaria del checador; se crea en cada prueba porque el almacén es nuevo.
    device.siteId = await createTestSite(container);
    const created = await api(adminToken)
      .post('/companies')
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    hrToken = await signInAs(container, { role: 'HR', companyId: created.body.id as string });
    const { registerUser, logIn } = container.cradle;
    const registered = await registerUser.execute({
      email: 'sin-rol@example.com',
      password: 'contraseña-larga-y-valida',
    });
    if (!registered.ok) throw registered.error;
    const session = await logIn.execute({
      email: 'sin-rol@example.com',
      password: 'contraseña-larga-y-valida',
      client: 'mobile',
      ip: null,
      userAgent: null,
    });
    if (!session.ok) throw session.error;
    noRoleToken = session.value.token;
  });

  describe('POST /attendance/devices', () => {
    it('HOLDING_ADMIN registra un equipo: 201 con el id', async () => {
      const response = await api(adminToken).post('/attendance/devices').send(device).expect(201);

      expect(response.body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('el mismo serial otra vez: 409 DEVICE_ALREADY_REGISTERED', async () => {
      await registerDevice();

      const response = await api(adminToken).post('/attendance/devices').send(device).expect(409);

      expect(response.body.code).toBe('DEVICE_ALREADY_REGISTERED');
    });

    it('sede inexistente: 404 SITE_NOT_FOUND', async () => {
      const response = await api(adminToken)
        .post('/attendance/devices')
        .send({ ...device, siteId: '00000000-0000-4000-8000-0000000000ff' })
        .expect(404);

      expect(response.body.code).toBe('SITE_NOT_FOUND');
    });

    it('con zona horaria y sin siteId: 400 VALIDATION_ERROR', async () => {
      const response = await api(adminToken)
        .post('/attendance/devices')
        .send({ serialNumber: 'TESTSN001', name: 'Entrada', timeZone: 'America/Cancun' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['serial con símbolos', { serialNumber: 'SN-001' }],
      ['nombre vacío', { name: '' }],
      ['sin sede', { siteId: undefined }],
    ])('%s: 400 VALIDATION_ERROR', async (_name, override) => {
      const response = await api(adminToken)
        .post('/attendance/devices')
        .send({ ...device, ...override })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_ERROR');
    });

    it('HR: 403 FORBIDDEN (solo tiene attendance.devices:read)', async () => {
      const response = await api(hrToken).post('/attendance/devices').send(device).expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const response = await api(null).post('/attendance/devices').send(device).expect(401);

      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('PUT /attendance/devices/:deviceId/site', () => {
    /** Equipo registrado antes del plan 003: sin sede y con una zona libre. */
    async function legacyDevice(): Promise<string> {
      const id = '00000000-0000-4000-8000-0000000000d1';
      await container.cradle.deviceRepository.save(
        Device.restore(id as DeviceId, {
          serialNumber: 'LEGACYSN1',
          name: 'Equipo anterior',
          timeZone: 'UTC',
          active: true,
          registeredAt: new Date('2026-01-15T12:00:00Z'),
          lastSeenAt: null,
          siteId: null,
          clockOffsetSeconds: null,
          clockOffsetMeasuredAt: null,
        }),
      );
      return id;
    }

    it('equipo sin sede: 204 y la lista muestra siteId y la zona de la sede', async () => {
      const id = await legacyDevice();
      const created = await container.cradle.createSite.execute({
        name: 'Sede CDMX',
        country: 'MX',
        timeZone: 'America/Mexico_City',
      });
      if (!created.ok) throw created.error;

      await api(adminToken)
        .put(`/attendance/devices/${id}/site`)
        .send({ siteId: created.value.id })
        .expect(204);

      const list = await api(adminToken).get('/attendance/devices').expect(200);
      expect(list.body.items[0]).toMatchObject({
        id,
        siteId: created.value.id,
        timeZone: 'America/Mexico_City',
      });
    });

    it('equipo inexistente: 404 DEVICE_NOT_FOUND', async () => {
      const response = await api(adminToken)
        .put('/attendance/devices/00000000-0000-4000-8000-0000000000ff/site')
        .send({ siteId: device.siteId })
        .expect(404);

      expect(response.body.code).toBe('DEVICE_NOT_FOUND');
    });

    it('sede inexistente: 404 SITE_NOT_FOUND', async () => {
      const id = await registerDevice();

      const response = await api(adminToken)
        .put(`/attendance/devices/${id}/site`)
        .send({ siteId: '00000000-0000-4000-8000-0000000000ff' })
        .expect(404);

      expect(response.body.code).toBe('SITE_NOT_FOUND');
    });

    it('body sin siteId o deviceId no UUID: 400 VALIDATION_ERROR', async () => {
      const id = await registerDevice();

      const noSite = await api(adminToken)
        .put(`/attendance/devices/${id}/site`)
        .send({})
        .expect(400);
      const badId = await api(adminToken)
        .put('/attendance/devices/no-uuid/site')
        .send({ siteId: device.siteId })
        .expect(400);

      expect(noSite.body.code).toBe('VALIDATION_ERROR');
      expect(badId.body.code).toBe('VALIDATION_ERROR');
    });

    it('HR: 403 FORBIDDEN; sin sesión: 401', async () => {
      const id = await registerDevice();

      const forbidden = await api(hrToken)
        .put(`/attendance/devices/${id}/site`)
        .send({ siteId: device.siteId })
        .expect(403);
      await api(null)
        .put(`/attendance/devices/${id}/site`)
        .send({ siteId: device.siteId })
        .expect(401);

      expect(forbidden.body.code).toBe('FORBIDDEN');
    });
  });

  describe('GET /attendance/devices', () => {
    it('HOLDING_ADMIN y HR lo listan; el equipo recién registrado no tiene contacto ni marcaciones', async () => {
      const id = await registerDevice();

      for (const token of [adminToken, hrToken]) {
        const response = await api(token).get('/attendance/devices').expect(200);
        expect(response.body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
        expect(response.body.items[0]).toMatchObject({
          id,
          serialNumber: 'TESTSN001',
          name: 'Entrada principal',
          timeZone: 'America/Cancun',
          active: true,
          lastSeenAt: null,
          lastPunchAt: null,
          siteId: device.siteId,
          clockOffsetSeconds: null,
          clockOffsetMeasuredAt: null,
          clockSuspect: false,
        });
      }
    });

    it('tras un contacto y un push, lastSeenAt y lastPunchAt dejan de ser null', async () => {
      await registerDevice();
      await request(app).get('/iclock/cdata?SN=TESTSN001&options=all').expect(200);
      await pushAttlog().expect(200);

      const response = await api(adminToken).get('/attendance/devices').expect(200);

      const item = response.body.items[0];
      expect(item.lastSeenAt).not.toBeNull();
      expect(item.lastPunchAt).toBe('2026-09-28T17:17:29.000Z');
    });

    it('pagina con pageSize', async () => {
      await registerDevice({ ...device, serialNumber: 'SN2', name: 'B' });
      await registerDevice({ ...device, serialNumber: 'SN1', name: 'A' });

      const response = await api(adminToken)
        .get('/attendance/devices?pageSize=1&page=2')
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(field(response, 'name')).toEqual(['B']);
    });

    it('sin sesión: 401; sin rol: 403', async () => {
      await api(null).get('/attendance/devices').expect(401);
      const response = await api(noRoleToken).get('/attendance/devices').expect(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });
  });

  describe('/iclock contra el registro de equipos', () => {
    it('un equipo registrado recibe el bloque de opciones', async () => {
      await registerDevice();

      const response = await request(app).get('/iclock/cdata?SN=TESTSN001&options=all');

      expect(response.status).toBe(200);
      expect(response.text.split('\n')[0]).toBe('GET OPTION FROM: TESTSN001');
    });

    it('un serial no registrado recibe 403 y su push no guarda nada', async () => {
      await registerDevice();

      const handshake = await request(app).get('/iclock/cdata?SN=OTRO&options=all');
      const push = await pushAttlog('OTRO');
      const punches = await api(adminToken).get('/attendance/punches').expect(200);

      expect(handshake.status).toBe(403);
      expect(handshake.text).toBe('ERROR: dispositivo no autorizado');
      expect(push.status).toBe(403);
      expect(punches.body.total).toBe(0);
    });

    it('el push de ATTLOG responde OK: n y reenviarlo no duplica marcaciones', async () => {
      await registerDevice();

      const first = await pushAttlog();
      const again = await pushAttlog();
      const punches = await api(adminToken).get('/attendance/punches').expect(200);

      expect(first.text).toBe('OK: 2');
      expect(again.text).toBe('OK: 2');
      expect(punches.body.total).toBe(2);
    });

    it('una línea con fecha imposible no se guarda pero cuenta en OK: n', async () => {
      await registerDevice();

      const push = await pushAttlog(
        device.serialNumber,
        TWO_PUNCHES + '3\t2026-02-30 08:00:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n',
      );
      const punches = await api(adminToken).get('/attendance/punches').expect(200);

      expect(push.text).toBe('OK: 3');
      expect(punches.body.total).toBe(2);
    });

    it('un push de OPERLOG no escribe marcaciones', async () => {
      await registerDevice();

      const push = await request(app)
        .post('/iclock/cdata?SN=TESTSN001&table=OPERLOG')
        .set('Content-Type', 'text/plain')
        .send('USER PIN=1\tName=Prueba\tPri=0\tPasswd=1234\tCard=\tGrp=1');
      const punches = await api(adminToken).get('/attendance/punches').expect(200);

      expect(push.text).toBe('OK: 1');
      expect(punches.body.total).toBe(0);
    });
  });

  describe('GET /attendance/punches', () => {
    it('HOLDING_ADMIN: más reciente primero, con hora local y UTC', async () => {
      const deviceId = await registerDevice();
      await pushAttlog();

      const response = await api(adminToken).get('/attendance/punches').expect(200);

      expect(response.body.total).toBe(2);
      expect(response.body.items[0]).toMatchObject({
        deviceId,
        serialNumber: 'TESTSN001',
        pin: '2',
        occurredAt: '2026-09-28T17:17:29.000Z',
        deviceLocalTime: '2026-09-28 12:17:29',
        status: '0',
        verifyMode: '15',
      });
      expect(response.body.items[1]).toMatchObject({ pin: '1' });
    });

    it('filtra por deviceId, pin y rango from/to', async () => {
      const deviceId = await registerDevice();
      await registerDevice({ ...device, serialNumber: 'SN2', name: 'Otro' });
      await pushAttlog();
      await pushAttlog('SN2', '1\t2026-09-28 09:00:00\t0\t1\t0\t0\t0\t0\t0\t0\t\n');

      const byDevice = await api(adminToken).get(`/attendance/punches?deviceId=${deviceId}`);
      const byPin = await api(adminToken).get('/attendance/punches?pin=1');
      const byRange = await api(adminToken).get(
        '/attendance/punches?from=2026-09-28T17:00:00.000Z&to=2026-09-28T18:00:00.000Z',
      );

      expect(byDevice.body.total).toBe(2);
      expect(byPin.body.total).toBe(2);
      expect(field(byRange, 'pin')).toEqual(['2']);
    });

    it('pagina con pageSize', async () => {
      await registerDevice();
      await pushAttlog();

      const response = await api(adminToken)
        .get('/attendance/punches?pageSize=1&page=2')
        .expect(200);

      expect(response.body.total).toBe(2);
      expect(field(response, 'pin')).toEqual(['1']);
    });

    it('filtros inválidos: 400 VALIDATION_ERROR', async () => {
      for (const query of ['deviceId=no-uuid', 'from=ayer', 'pageSize=1000']) {
        const response = await api(adminToken).get(`/attendance/punches?${query}`).expect(400);
        expect(response.body.code).toBe('VALIDATION_ERROR');
      }
    });

    it('HR: 200 (solo ve marcaciones con RFC de su empresa); sin sesión: 401', async () => {
      await api(hrToken).get('/attendance/punches').expect(200);
      await api(null).get('/attendance/punches').expect(401);
    });
  });
});
