import { createEvent, Email, NationalId, PersonalRfc } from '@rrhh/domain';
import { asValue } from 'awilix';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { wireSubscriptions } from '@/container';
import { API_PREFIX, createApp } from '@/http/app';
import { SyncDevice } from '@/modules/attendance/application/commands/sync-device.command';
import { SyncEmployee } from '@/modules/attendance/application/commands/sync-employee.command';
import { DeviceUserSync } from '@/modules/attendance/application/device-user-sync';
import type { DeviceId } from '@/modules/attendance/domain/device';
import { Device } from '@/modules/attendance/domain/device';
import { Employee, type EmployeeId } from '@/modules/employees/domain/employee';
import { RecordingLogger } from '@/shared/testing/fakes';

import { buildTestContainer, createTestSite, signInAs } from './test-app';

/**
 * Sincronización de colaboradores con los checadores (plan attendance-marcaciones/007): criterios
 * de aceptación 1 a 7 sobre el contenedor real con persistencia en memoria y las suscripciones
 * conectadas. La barrera (plan 008) exige redes permitidas antes de que llegue cualquier usuario.
 */
const NETWORK = '10.0.0.0/8';
const OTHER_NETWORK = '192.168.0.0/16';
const NO_DEVICE = '00000000-0000-4000-8000-0000000000ff';
const LUIS_ID = '00000000-0000-4000-8000-0000000000a1';

const ana = {
  nationalId: { country: 'MX', number: 'GOMA850101HQRRRN04' },
  rfc: 'GOMA850101AB1',
  firstName: 'Ana',
  lastName: 'Rojas',
  email: 'ana@aps.example',
  hireDate: '2026-01-10',
};
const pedro = {
  nationalId: { country: 'MX', number: 'PEXL900215MDFRPR07' },
  rfc: 'PEXL900215AB2',
  firstName: 'Pedro',
  lastName: 'Lara',
  email: 'pedro@aps.example',
  hireDate: '2026-01-10',
};
const diego = {
  nationalId: { country: 'MX', number: 'ROSA010305HQRDNLA3' },
  rfc: 'ROSA010305AB1',
  firstName: 'Diego',
  lastName: 'Rosas',
  email: 'diego@aps.example',
  hireDate: '2026-01-10',
};

interface ListedCommand {
  command: string;
  status: string;
  queuedBy: string | null;
}

describe('sincronización de colaboradores con los checadores (HTTP)', () => {
  let container: ReturnType<typeof buildTestContainer>;
  let app: ReturnType<typeof createApp>;
  let logger: RecordingLogger;
  let adminToken: string;
  let hrToken: string;
  let companyId: string;
  let siteS: string;
  let siteT: string;

  const call = (method: 'get' | 'post' | 'put', path: string, token: string | null) => {
    const test = request(app)[method](`${API_PREFIX}${path}`);
    return token ? test.set('Authorization', `Bearer ${token}`) : test;
  };
  const admin = (method: 'get' | 'post' | 'put', path: string) => call(method, path, adminToken);

  async function registerDevice(serialNumber: string, siteId: string): Promise<string> {
    const response = await admin('post', '/attendance/devices')
      .send({ serialNumber, name: serialNumber, siteId })
      .expect(201);
    return response.body.id as string;
  }

  const setNetworks = (id: string, networks: string[]) =>
    admin('put', `/attendance/devices/${id}/networks`).send({ allowedNetworks: networks });

  const sync = (id: string, token: string | null = adminToken) =>
    call('post', `/attendance/devices/${id}/sync`, token);

  async function commandsOf(id: string): Promise<ListedCommand[]> {
    const response = await admin('get', `/attendance/devices/${id}/commands`).expect(200);
    return response.body.items as ListedCommand[];
  }

  async function texts(id: string): Promise<string[]> {
    return (await commandsOf(id)).map((entry) => entry.command);
  }

  /** Texto de cada comando con solo el PIN y la operación, para comparar sin el resto del formato. */
  async function operations(id: string): Promise<string[]> {
    return (await texts(id)).map(
      (text) =>
        /^DATA (UPDATE|DELETE) USERINFO PIN=([^\t]+)/.exec(text)?.slice(1).join(' ') ?? text,
    );
  }

  const hire = (body: object) =>
    admin('post', `/companies/${companyId}/employees`).send({ siteId: siteS, ...body });

  async function employeeIdOf(rfc: string): Promise<string> {
    const list = await admin('get', `/companies/${companyId}/employees`).expect(200);
    const found = (list.body.items as { id: string; rfc: string | null }[]).find(
      (item) => item.rfc === rfc,
    );
    if (!found) throw new Error('fixture: colaborador no encontrado');
    return found.id;
  }

  /**
   * Inserta directo en el repositorio, sin eventos: una fila anterior al RFC obligatorio (`person`
   * null, que ningún endpoint crea) o un alta que el API de asistencia aún no conoce.
   */
  async function insertEmployee(
    person: typeof ana | null,
    firstName: string,
    lastName: string,
    id: string,
  ): Promise<string> {
    const nationalId = NationalId.create('MX', person?.nationalId.number ?? 'ROSA010305HQRDNLA3');
    const email = Email.create(`${firstName.toLowerCase()}@aps.example`);
    const rfc = person ? PersonalRfc.create(person.rfc) : null;
    if (!nationalId.ok || !email.ok || (rfc && !rfc.ok)) throw new Error('fixture inválido');
    await container.cradle.employeeRepository.save(
      Employee.restore(id as EmployeeId, {
        companyId,
        nationalId: nationalId.value,
        rfc: rfc?.ok ? rfc.value : null,
        siteId: siteS,
        firstName,
        lastName,
        email: email.value,
        positionTitle: null,
        hireDate: new Date('2025-01-01T00:00:00Z'),
        status: 'ACTIVE',
      }),
    );
    return id;
  }

  beforeEach(async () => {
    container = buildTestContainer();
    // Los casos de uso de sincronización con un logger observable; antes de conectar las suscripciones.
    logger = new RecordingLogger();
    const cradle = container.cradle;
    const deviceUserSync = new DeviceUserSync({
      deviceCommandRepository: cradle.deviceCommandRepository,
      deviceUserRepository: cradle.deviceUserRepository,
      idGenerator: cradle.idGenerator,
      clock: cradle.clock,
      logger,
    });
    container.register({
      deviceUserSync: asValue(deviceUserSync),
      syncDevice: asValue(
        new SyncDevice({
          deviceRepository: cradle.deviceRepository,
          deviceUserRepository: cradle.deviceUserRepository,
          siteRoster: cradle.siteRoster,
          deviceUserSync,
          logger,
        }),
      ),
      syncEmployee: asValue(
        new SyncEmployee({
          deviceRepository: cradle.deviceRepository,
          deviceUserRepository: cradle.deviceUserRepository,
          siteRoster: cradle.siteRoster,
          deviceUserSync,
          logger,
        }),
      ),
    });
    wireSubscriptions(container);
    app = createApp(container);
    adminToken = await signInAs(container, { role: 'HOLDING_ADMIN' });
    siteS = await createTestSite(container, 'Sede S');
    siteT = await createTestSite(container, 'Sede T');
    const company = await admin('post', '/companies')
      .send({ legalName: 'Alfa SA de CV', taxId: 'EKU9003173C9', country: 'MX' })
      .expect(201);
    companyId = company.body.id as string;
    hrToken = await signInAs(container, { role: 'HR', companyId });
  });

  describe('criterio 1: el equipo recibe a la sede al habilitar redes, no al registrarse', () => {
    it('registrar no encola nada; poner redes encola un UPDATE por colaborador con RFC; reemplazar redes no repite', async () => {
      await hire(ana).expect(201);
      await hire(pedro).expect(201);
      await insertEmployee(null, 'Luis', 'Antiguo', LUIS_ID);

      const deviceId = await registerDevice('TESTSN001', siteS);
      expect(await commandsOf(deviceId)).toEqual([]);

      await setNetworks(deviceId, [NETWORK]).expect(204);

      const queued = await commandsOf(deviceId);
      expect(queued).toHaveLength(2);
      expect(queued.every((entry) => entry.status === 'QUEUED' && entry.queuedBy === null)).toBe(
        true,
      );
      expect(await operations(deviceId)).toEqual(
        expect.arrayContaining([`UPDATE ${ana.rfc}`, `UPDATE ${pedro.rfc}`]),
      );
      expect((await texts(deviceId)).join('\n')).not.toContain('Luis');

      await setNetworks(deviceId, [OTHER_NETWORK]).expect(204);

      expect(await commandsOf(deviceId)).toHaveLength(2);
    });
  });

  describe('criterio 2: POST /attendance/devices/:deviceId/sync', () => {
    it('HOLDING_ADMIN: 200 con NO_RFC; repetido antes de que el equipo consulte no duplica comandos', async () => {
      await hire(ana).expect(201);
      await hire(pedro).expect(201);
      const luis = await insertEmployee(null, 'Luis', 'Antiguo', LUIS_ID);
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      expect(await commandsOf(deviceId)).toHaveLength(2);

      const first = await sync(deviceId).expect(200);
      const second = await sync(deviceId).expect(200);

      const expected = {
        queued: 0,
        removed: 0,
        skipped: [{ employeeId: luis, fullName: 'Luis Antiguo', reason: 'NO_RFC' }],
      };
      expect(first.body).toEqual(expected);
      expect(second.body).toEqual(expected);
      expect(await commandsOf(deviceId)).toHaveLength(2);
    });

    it('encola a quien el API aún no conocía y da de baja a quien ya no es de la sede', async () => {
      await hire(ana).expect(201);
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      // Pedro llega a employees sin pasar por eventos (p. ej. un alta con las suscripciones caídas).
      await insertEmployee(pedro, 'Pedro', 'Lara', '00000000-0000-4000-8000-0000000000a2');
      // Un usuario del registro cuyo colaborador ya no es de la sede.
      await container.cradle.deviceUserRepository.put({
        deviceId: deviceId as DeviceId,
        pin: 'ROSA010305AB1',
        employeeId: '00000000-0000-4000-8000-0000000000a3',
        syncedAt: new Date('2026-10-08T12:00:00Z'),
      });

      const response = await sync(deviceId).expect(200);

      expect(response.body).toEqual({ queued: 1, removed: 1, skipped: [] });
      expect(await operations(deviceId)).toEqual(
        expect.arrayContaining([
          `UPDATE ${ana.rfc}`,
          `UPDATE ${pedro.rfc}`,
          'DELETE ROSA010305AB1',
        ]),
      );
      expect(await commandsOf(deviceId)).toHaveLength(3);
    });

    it('HR: 403 FORBIDDEN; sin sesión: 401 AUTHENTICATION_REQUIRED', async () => {
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);

      const forbidden = await sync(deviceId, hrToken).expect(403);
      const anonymous = await sync(deviceId, null).expect(401);

      expect(forbidden.body.code).toBe('FORBIDDEN');
      expect(anonymous.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('equipo inexistente: 404 DEVICE_NOT_FOUND; id que no es UUID: 400 VALIDATION_ERROR', async () => {
      const missing = await sync(NO_DEVICE).expect(404);
      const malformed = await sync('no-uuid').expect(400);

      expect(missing.body.code).toBe('DEVICE_NOT_FOUND');
      expect(malformed.body.code).toBe('VALIDATION_ERROR');
    });

    it('equipo anterior al plan, sin sede: 422 DEVICE_WITHOUT_SITE', async () => {
      const id = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
      await container.cradle.deviceRepository.add(
        Device.restore(id, {
          serialNumber: 'LEGACYSN1',
          name: 'Anterior',
          timeZone: 'UTC',
          active: true,
          registeredAt: new Date('2026-01-15T12:00:00Z'),
          lastSeenAt: null,
          siteId: null,
          clockOffsetSeconds: null,
          clockOffsetMeasuredAt: null,
          allowedNetworks: [NETWORK],
          lastSeenIp: null,
        }),
      );

      const response = await sync(id).expect(422);

      expect(response.body.code).toBe('DEVICE_WITHOUT_SITE');
      expect(response.body.details).toEqual({ deviceId: id });
    });

    it('equipo sin redes permitidas: 422 DEVICE_NETWORK_UNRESTRICTED y nada encolado', async () => {
      await hire(ana).expect(201);
      const deviceId = await registerDevice('TESTSN001', siteS);

      const response = await sync(deviceId).expect(422);

      expect(response.body.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
      expect(await commandsOf(deviceId)).toEqual([]);
    });
  });

  describe('criterio 3: equipos con y sin redes en la misma sede', () => {
    it('el alta solo llega al equipo con redes, avisa del otro con su id, y al habilitarlo recibe a toda la sede', async () => {
      await hire(ana).expect(201);
      const withNetworks = await registerDevice('TESTSN001', siteS);
      const without = await registerDevice('TESTSN002', siteS);
      await setNetworks(withNetworks, [NETWORK]).expect(204);
      logger.entries.length = 0;

      await hire(pedro).expect(201);

      expect(await operations(withNetworks)).toEqual(
        expect.arrayContaining([`UPDATE ${ana.rfc}`, `UPDATE ${pedro.rfc}`]),
      );
      expect(await commandsOf(without)).toEqual([]);
      expect(logger.entries).toContainEqual({
        level: 'warn',
        obj: { deviceId: without, employeeId: await employeeIdOf(pedro.rfc) },
        msg: 'zkteco: checador sin redes, sincronización omitida',
      });
      expect(await container.cradle.deviceUserRepository.listByDevice(without as DeviceId)).toEqual(
        [],
      );

      await setNetworks(without, [NETWORK]).expect(204);

      expect(await operations(without)).toEqual(
        expect.arrayContaining([`UPDATE ${ana.rfc}`, `UPDATE ${pedro.rfc}`]),
      );
      expect(await commandsOf(without)).toHaveLength(2);
    });
  });

  describe('criterio 4: movimientos del colaborador', () => {
    let s1: string;
    let s2: string;
    let t1: string;

    beforeEach(async () => {
      s1 = await registerDevice('TESTSN001', siteS);
      s2 = await registerDevice('TESTSN002', siteS);
      t1 = await registerDevice('TESTSN003', siteT);
      for (const id of [s1, s2, t1]) await setNetworks(id, [NETWORK]).expect(204);
    });

    it('el alta con RFC encola un UPDATE en cada equipo de la sede con redes y en ninguno de otra', async () => {
      await hire(diego).expect(201);

      expect(await operations(s1)).toEqual([`UPDATE ${diego.rfc}`]);
      expect(await operations(s2)).toEqual([`UPDATE ${diego.rfc}`]);
      expect(await commandsOf(t1)).toEqual([]);
    });

    it('PUT .../site a otra sede: DELETE en los equipos de la sede anterior y UPDATE en los de la nueva', async () => {
      await hire(diego).expect(201);
      const id = await employeeIdOf(diego.rfc);

      await admin('put', `/companies/${companyId}/employees/${id}/site`)
        .send({ siteId: siteT })
        .expect(204);

      expect(await operations(s1)).toEqual(
        expect.arrayContaining([`UPDATE ${diego.rfc}`, `DELETE ${diego.rfc}`]),
      );
      expect(await operations(s2)).toHaveLength(2);
      expect(await operations(s2)).toContain(`DELETE ${diego.rfc}`);
      expect(await operations(t1)).toEqual([`UPDATE ${diego.rfc}`]);
    });

    it('PUT .../rfc con un RFC nuevo: DELETE del PIN viejo y UPDATE del nuevo', async () => {
      await hire(diego).expect(201);
      const id = await employeeIdOf(diego.rfc);

      await admin('put', `/companies/${companyId}/employees/${id}/rfc`)
        .send({ rfc: 'ROSA010305ZZ9' })
        .expect(204);

      expect(await operations(s1)).toEqual(
        expect.arrayContaining([
          `UPDATE ${diego.rfc}`,
          `DELETE ${diego.rfc}`,
          'UPDATE ROSA010305ZZ9',
        ]),
      );
      expect(await operations(s1)).toHaveLength(3);
    });
  });

  describe('criterio 5: baja del colaborador', () => {
    it('un EMPLOYEE_TERMINATED sintético da DELETE del PIN en los equipos donde se puso', async () => {
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      await hire(ana).expect(201);
      const id = await employeeIdOf(ana.rfc);
      const employee = await container.cradle.employeeRepository.findById(id as EmployeeId);
      if (!employee) throw new Error('fixture: colaborador no encontrado');
      const terminated = employee.terminate(new Date('2026-02-01'), new Date('2026-02-01'));
      if (!terminated.ok) throw terminated.error;
      await container.cradle.employeeRepository.save(employee);

      await container.cradle.eventBus.publish(employee.pullEvents());

      expect((await operations(deviceId)).sort()).toEqual([
        `DELETE ${ana.rfc}`,
        `UPDATE ${ana.rfc}`,
      ]);
    });
  });

  describe('criterio 6: cambio de sede del equipo', () => {
    it('DELETE de los PIN sincronizados de la sede vieja, UPDATE de la nueva, y nada a usuarios ajenos', async () => {
      await hire(ana).expect(201);
      await hire(pedro).expect(201);
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      // Un usuario que el API no creó: no está en `device_users`.
      expect(
        await container.cradle.deviceUserRepository.listByDevice(deviceId as DeviceId),
      ).toHaveLength(2);
      // En la sede T trabaja Diego.
      await admin('post', `/companies/${companyId}/employees`)
        .send({ siteId: siteT, ...diego })
        .expect(201);

      await admin('put', `/attendance/devices/${deviceId}/site`)
        .send({ siteId: siteT })
        .expect(204);

      expect(await operations(deviceId)).toEqual(
        expect.arrayContaining([
          `UPDATE ${ana.rfc}`,
          `UPDATE ${pedro.rfc}`,
          `DELETE ${ana.rfc}`,
          `DELETE ${pedro.rfc}`,
          `UPDATE ${diego.rfc}`,
        ]),
      );
      expect(await operations(deviceId)).toHaveLength(5);
      const rows = await container.cradle.deviceUserRepository.listByDevice(deviceId as DeviceId);
      expect(rows.map((row) => row.pin)).toEqual([diego.rfc]);
    });
  });

  describe('criterio 7: privacidad de los logs', () => {
    it('ninguna línea del log de la sincronización lleva un RFC ni un nombre', async () => {
      await hire(ana).expect(201);
      await insertEmployee(null, 'Luis', 'Antiguo', LUIS_ID);
      const deviceId = await registerDevice('TESTSN001', siteS);
      const bare = await registerDevice('TESTSN002', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      await sync(deviceId).expect(200);
      await sync(bare).expect(422);
      await hire(pedro).expect(201);

      expect(logger.entries.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(logger.entries);
      for (const secret of [ana.rfc, pedro.rfc, 'Ana', 'Pedro', 'Rojas', 'Antiguo']) {
        expect(serialized).not.toContain(secret);
      }
    });
  });

  describe('suscripciones: payload malformado', () => {
    it('un evento sin el id esperado no rompe al publicador ni encola nada', async () => {
      const deviceId = await registerDevice('TESTSN001', siteS);
      await setNetworks(deviceId, [NETWORK]).expect(204);
      await hire(ana).expect(201);
      const before = (await commandsOf(deviceId)).length;

      await expect(
        container.cradle.eventBus.publish([
          createEvent('attendance.device.commands-enabled', {}),
          createEvent('employees.employee.terminated', { employeeId: 5 }),
        ]),
      ).resolves.toBeUndefined();

      expect(await commandsOf(deviceId)).toHaveLength(before);
    });
  });

  describe('OpenAPI', () => {
    it('GET /openapi.json documenta el POST de sync con attendance.devices:manage', async () => {
      const response = await request(app).get(`${API_PREFIX}/openapi.json`).expect(200);

      const operation = response.body.paths['/attendance/devices/{deviceId}/sync'].post;
      expect(operation['x-permission']).toBe('attendance.devices:manage');
    });
  });
});
