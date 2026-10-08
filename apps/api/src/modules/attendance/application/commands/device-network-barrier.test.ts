import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../../domain/device-command';
import type { DevicePushRecord } from '../../domain/device-record';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
  InMemoryDeviceRepository,
  InMemoryPunchRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { AssignDeviceSite } from './assign-device-site.command';
import { QueueDeviceCommand } from './queue-device-command.command';
import {
  RecordDeviceContact,
  type RecordDeviceContactInput,
} from './record-device-contact.command';
import { RecordDevicePush } from './record-device-push.command';
import { SetDeviceNetworks } from './set-device-networks.command';
import { TakeDeviceCommand } from './take-device-command.command';

/**
 * Barrera de red por checador (plan attendance-marcaciones/005): cada caso de uso de /iclock
 * evalúa la IP de origen contra las redes del equipo, y solo un equipo con redes recibe comandos.
 */
const SERIAL = 'TESTSN001';
const SITE_ID = '00000000-0000-4000-8000-0000000000b1';
const ORIGINAL_SITE_ID = '00000000-0000-4000-8000-0000000000a1';
const QUEUED_BY = '00000000-0000-4000-8000-0000000000a1';
const COMMAND = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';

const attendanceRecord: DevicePushRecord = {
  kind: 'attendance',
  pin: '1',
  deviceTime: '2026-09-28 08:01:00',
  status: '0',
  verifyMode: '1',
  extraFields: 6,
};

async function setUp(networks: readonly string[] = []) {
  const store = new InMemoryAttendanceStore();
  const logger = new RecordingLogger();
  const clock = new FixedClock();
  const idGenerator = new SequentialIdGenerator();
  const deviceRepository = new InMemoryDeviceRepository(store);
  const deviceCommandRepository = new InMemoryDeviceCommandRepository(store);
  const punchRepository = new InMemoryPunchRepository(store);

  const registered = Device.register({
    id: idGenerator.next() as DeviceId,
    serialNumber: SERIAL,
    name: 'Entrada',
    siteId: ORIGINAL_SITE_ID,
    timeZone: 'America/Cancun',
    now: clock.now(),
  });
  if (!registered.ok) throw registered.error;
  const set = registered.value.setAllowedNetworks(networks);
  if (!set.ok) throw set.error;
  await deviceRepository.add(registered.value);
  const device = registered.value;

  return {
    store,
    logger,
    clock,
    device,
    deviceRepository,
    deviceCommandRepository,
    punchRepository,
    contact: new RecordDeviceContact({ logger, deviceRepository, clock }),
    push: new RecordDevicePush({
      logger,
      deviceRepository,
      punchRepository,
      idGenerator,
      clock,
    }),
    setNetworks: new SetDeviceNetworks({ deviceRepository, logger }),
    queue: new QueueDeviceCommand({
      deviceRepository,
      deviceCommandRepository,
      idGenerator,
      clock,
      logger,
    }),
    take: new TakeDeviceCommand({ deviceRepository, deviceCommandRepository, clock, logger }),
    assignSite: new AssignDeviceSite({
      deviceRepository,
      deviceSiteDirectory: {
        find: (id: string) =>
          Promise.resolve(
            id === SITE_ID ? { id, timeZone: 'America/Mexico_City', active: true } : null,
          ),
      },
    }),
  };
}

const contactInput = (sourceIp: string | null): RecordDeviceContactInput => ({
  serialNumber: SERIAL,
  kind: 'poll',
  method: 'GET',
  path: '/iclock/getrequest',
  query: { SN: SERIAL },
  bodyLength: 0,
  body: '',
  sourceIp,
});

describe('RecordDeviceContact: barrera de red', () => {
  it('IP fuera de las redes: DEVICE_NOT_ALLOWED, warn con serial e IP, y no anota el contacto', async () => {
    const { contact, logger, deviceRepository, device } = await setUp(['10.9.9.0/24']);

    const result = await contact.execute(contactInput('203.0.113.7'));

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: {
          serialNumber: SERIAL,
          sourceIp: '203.0.113.7',
          kind: 'poll',
          method: 'GET',
          path: '/iclock/getrequest',
          query: { SN: SERIAL },
          bodyLength: 0,
        },
        msg: 'zkteco: IP no permitida',
      },
    ]);
    const stored = await deviceRepository.findById(device.id);
    expect(stored?.lastSeenAt).toBeNull();
    expect(stored?.lastSeenIp).toBeNull();
  });

  it('la respuesta de IP no permitida es idéntica a la de un serial desconocido', async () => {
    const { contact } = await setUp(['10.9.9.0/24']);

    const blockedIp = await contact.execute(contactInput('203.0.113.7'));
    const unknownSerial = await contact.execute({ ...contactInput('10.9.9.5'), serialNumber: 'X' });

    expect(!blockedIp.ok && blockedIp.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(!unknownSerial.ok && unknownSerial.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(!blockedIp.ok && blockedIp.error.message).toBe(
      !unknownSerial.ok && unknownSerial.error.message,
    );
  });

  it('IP desconocida (null) con redes configuradas: rechazada', async () => {
    const { contact } = await setUp(['0.0.0.0/0']);

    const result = await contact.execute(contactInput(null));

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
  });

  it('IP dentro de las redes (también en forma IPv4 mapeada): acepta y guarda la IP normalizada', async () => {
    const { contact, deviceRepository, device, clock } = await setUp(['10.9.9.0/24']);

    const result = await contact.execute(contactInput('::ffff:10.9.9.5'));

    expect(result.ok).toBe(true);
    const stored = await deviceRepository.findById(device.id);
    expect(stored?.lastSeenIp).toBe('10.9.9.5');
    expect(stored?.lastSeenAt).toEqual(clock.now());
  });

  it('sin redes acepta cualquier IP (nada se rompe al desplegar) y guarda la IP', async () => {
    const { contact, deviceRepository, device } = await setUp([]);

    const result = await contact.execute(contactInput('203.0.113.7'));

    expect(result.ok).toBe(true);
    expect((await deviceRepository.findById(device.id))?.lastSeenIp).toBe('203.0.113.7');
  });

  it('un cambio de IP dentro del minuto de resolución sí se persiste', async () => {
    const { contact, deviceRepository, device, clock } = await setUp([]);
    await contact.execute(contactInput('10.0.0.1'));
    clock.set(new Date(clock.now().getTime() + 5_000));

    await contact.execute(contactInput('10.0.0.2'));

    const stored = await deviceRepository.findById(device.id);
    expect(stored?.lastSeenIp).toBe('10.0.0.2');
    expect(stored?.lastSeenAt).toEqual(clock.now());
  });

  it('un equipo inactivo sigue rechazándose por el motivo de siempre, antes que por la IP', async () => {
    const { contact, logger, deviceRepository, device } = await setUp(['10.9.9.0/24']);
    await deviceRepository.add(
      Device.restore('00000000-0000-4000-8000-0000000000bb' as DeviceId, {
        serialNumber: 'INACTIVO',
        name: 'Inactivo',
        timeZone: 'UTC',
        active: false,
        registeredAt: device.registeredAt,
        lastSeenAt: null,
        siteId: null,
        clockOffsetSeconds: null,
        clockOffsetMeasuredAt: null,
        allowedNetworks: [],
        lastSeenIp: null,
      }),
    );

    await contact.execute({ ...contactInput('10.9.9.5'), serialNumber: 'INACTIVO' });

    expect(logger.entries[0]?.msg).toBe('zkteco: dispositivo no autorizado');
  });
});

describe('RecordDevicePush: barrera de red', () => {
  it('IP fuera de las redes: DEVICE_NOT_ALLOWED, warn con serial, tabla e IP, sin guardar marcaciones', async () => {
    const { push, logger, store } = await setUp(['10.9.9.0/24']);

    const result = await push.execute({
      serialNumber: SERIAL,
      table: 'ATTLOG',
      records: [attendanceRecord],
      sourceIp: '203.0.113.7',
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(store.punches.size).toBe(0);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { serialNumber: SERIAL, table: 'ATTLOG', sourceIp: '203.0.113.7' },
        msg: 'zkteco: IP no permitida',
      },
    ]);
  });

  it('no lee `records` cuando la IP no está permitida', async () => {
    const { push } = await setUp(['10.9.9.0/24']);
    let accessed = false;

    const result = await push.execute({
      serialNumber: SERIAL,
      table: 'ATTLOG',
      get records(): readonly DevicePushRecord[] {
        accessed = true;
        throw new Error('no debería leerse records de una IP no permitida');
      },
      sourceIp: '203.0.113.7',
    });

    expect(result.ok).toBe(false);
    expect(accessed).toBe(false);
  });

  it('IP dentro de las redes: guarda la marcación y la IP de origen', async () => {
    const { push, store, deviceRepository, device } = await setUp(['10.9.9.0/24']);

    const result = await push.execute({
      serialNumber: SERIAL,
      table: 'ATTLOG',
      records: [attendanceRecord],
      sourceIp: '10.9.9.5',
    });

    expect(result.ok && result.value.accepted).toBe(1);
    expect(store.punches.size).toBe(1);
    expect((await deviceRepository.findById(device.id))?.lastSeenIp).toBe('10.9.9.5');
  });

  it('un equipo sin redes sigue recibiendo marcaciones desde cualquier IP', async () => {
    const { push, store } = await setUp([]);

    const result = await push.execute({
      serialNumber: SERIAL,
      table: 'ATTLOG',
      records: [attendanceRecord],
      sourceIp: '203.0.113.7',
    });

    expect(result.ok).toBe(true);
    expect(store.punches.size).toBe(1);
  });

  // Hallazgo attendance-escritura-completa-del-equipo: un `PUT .../site` que cae durante el
  // envío no debe deshacerse cuando el envío guarda su contacto.
  it('un cambio de sede hecho mientras el envío está en curso sobrevive al guardado del contacto', async () => {
    const setup = await setUp(['10.9.9.0/24']);
    const racingPunches = {
      saveNew: async (punches: Parameters<InMemoryPunchRepository['saveNew']>[0]) => {
        // El administrador cambia la sede después de que el envío cargó el equipo.
        const assigned = await setup.assignSite.execute({
          deviceId: setup.device.id,
          siteId: SITE_ID,
        });
        expect(assigned.ok).toBe(true);
        return setup.punchRepository.saveNew(punches);
      },
    };
    const push = new RecordDevicePush({
      logger: setup.logger,
      deviceRepository: setup.deviceRepository,
      punchRepository: racingPunches,
      idGenerator: new SequentialIdGenerator(),
      clock: setup.clock,
    });

    await push.execute({
      serialNumber: SERIAL,
      table: 'ATTLOG',
      records: [attendanceRecord],
      sourceIp: '10.9.9.5',
    });

    const stored = await setup.deviceRepository.findById(setup.device.id);
    expect(stored?.siteId).toBe(SITE_ID);
    expect(stored?.timeZone).toBe('America/Mexico_City');
    expect(stored?.lastSeenIp).toBe('10.9.9.5');
    expect(stored?.clockOffsetSeconds).not.toBeNull();
  });
});

describe('SetDeviceNetworks', () => {
  it('guarda las redes canónicas, solo esa columna, y registra el cambio', async () => {
    const { setNetworks, deviceRepository, device, logger } = await setUp([]);

    const result = await setNetworks.execute({
      deviceId: device.id,
      allowedNetworks: ['127.0.0.1', '10.1.2.3/24'],
    });

    expect(result.ok).toBe(true);
    const stored = await deviceRepository.findById(device.id);
    expect(stored?.allowedNetworks).toEqual(['127.0.0.1/32', '10.1.2.0/24']);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { serialNumber: SERIAL, allowedNetworks: ['127.0.0.1/32', '10.1.2.0/24'] },
        msg: 'zkteco: redes del equipo actualizadas',
      },
    ]);
  });

  it('una lista vacía quita la restricción', async () => {
    const { setNetworks, deviceRepository, device } = await setUp(['10.0.0.0/8']);

    const result = await setNetworks.execute({ deviceId: device.id, allowedNetworks: [] });

    expect(result.ok).toBe(true);
    expect((await deviceRepository.findById(device.id))?.allowedNetworks).toEqual([]);
  });

  it('equipo inexistente: DEVICE_NOT_FOUND y nada registrado', async () => {
    const { setNetworks, logger } = await setUp([]);

    const result = await setNetworks.execute({
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      allowedNetworks: ['127.0.0.1'],
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_FOUND');
    expect(logger.entries).toEqual([]);
  });

  it('una red inválida: INVALID_VALUE, no cambia las redes y no registra', async () => {
    const { setNetworks, deviceRepository, device, logger } = await setUp(['10.0.0.0/8']);

    const result = await setNetworks.execute({
      deviceId: device.id,
      allowedNetworks: ['10.0.0.0/33'],
    });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect((await deviceRepository.findById(device.id))?.allowedNetworks).toEqual(['10.0.0.0/8']);
    expect(logger.entries).toEqual([]);
  });

  it('más de 10 redes distintas: INVALID_VALUE', async () => {
    const { setNetworks, device } = await setUp([]);

    const result = await setNetworks.execute({
      deviceId: device.id,
      allowedNetworks: Array.from({ length: 11 }, (_, index) => `10.0.${index}.0/24`),
    });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('solo escribe sus columnas: no pisa el contacto ni la sede guardados por otro', async () => {
    const setup = await setUp([]);
    // El caso de uso carga el equipo; mientras tanto el equipo hace contacto y cambia la sede.
    const stale = await setup.deviceRepository.findById(setup.device.id);
    await setup.contact.execute(contactInput('10.0.0.1'));
    await setup.assignSite.execute({ deviceId: setup.device.id, siteId: SITE_ID });
    stale?.setAllowedNetworks(['10.0.0.0/8']);
    if (stale) await setup.deviceRepository.saveAllowedNetworks(stale);

    const stored = await setup.deviceRepository.findById(setup.device.id);
    expect(stored?.allowedNetworks).toEqual(['10.0.0.0/8']);
    expect(stored?.lastSeenIp).toBe('10.0.0.1');
    expect(stored?.siteId).toBe(SITE_ID);
  });
});

describe('QueueDeviceCommand: barrera de red', () => {
  it('equipo sin redes permitidas: DEVICE_NETWORK_UNRESTRICTED con details y nada encolado', async () => {
    const { queue, device, store, logger } = await setUp([]);

    const result = await queue.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
    expect(!result.ok && result.error.details).toEqual({ deviceId: device.id });
    expect(store.commands.size).toBe(0);
    expect(logger.entries).toEqual([]);
  });

  it('el equipo inexistente sigue dando DEVICE_NOT_FOUND antes que la regla de redes', async () => {
    const { queue } = await setUp([]);

    const result = await queue.execute({
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('con redes permitidas encola normalmente', async () => {
    const { queue, device, store } = await setUp(['127.0.0.1']);

    const result = await queue.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(result.ok).toBe(true);
    expect(store.commands.size).toBe(1);
  });
});

describe('TakeDeviceCommand: barrera de red', () => {
  async function queued(setup: Awaited<ReturnType<typeof setUp>>): Promise<DeviceCommandId> {
    const id = '00000000-0000-4000-8000-000000000101' as DeviceCommandId;
    const command = DeviceCommand.queue({
      id,
      deviceId: setup.device.id,
      number: 1,
      command: COMMAND,
      queuedBy: QUEUED_BY,
      now: new Date('2026-10-02T12:00:00Z'),
    });
    if (!command.ok) throw command.error;
    await setup.deviceCommandRepository.save(command.value);
    return id;
  }

  it('un comando encolado cuando había redes no se entrega al vaciar la lista y sigue QUEUED', async () => {
    const setup = await setUp(['127.0.0.1']);
    const id = await queued(setup);
    await setup.setNetworks.execute({ deviceId: setup.device.id, allowedNetworks: [] });

    const delivered = await setup.take.execute({ deviceId: setup.device.id });

    expect(delivered).toBeNull();
    expect(setup.store.commands.get(id)?.status).toBe('QUEUED');
    expect(setup.logger.entries.filter((e) => e.msg === 'zkteco: comando entregado')).toEqual([]);
  });

  it('si luego se vuelven a permitir redes, el comando pendiente se entrega', async () => {
    const setup = await setUp([]);
    const id = await queued(setup);
    expect(await setup.take.execute({ deviceId: setup.device.id })).toBeNull();

    await setup.setNetworks.execute({ deviceId: setup.device.id, allowedNetworks: ['127.0.0.1'] });

    // Desde el plan 006 el texto entregado lleva el número que asignó el API.
    expect(await setup.take.execute({ deviceId: setup.device.id })).toBe(`C:1:${COMMAND}`);
    expect(setup.store.commands.get(id)?.status).toBe('SENT');
  });

  it('un equipo inexistente devuelve null', async () => {
    const { take } = await setUp(['127.0.0.1']);

    expect(await take.execute({ deviceId: '00000000-0000-4000-8000-0000000000ff' })).toBeNull();
  });
});

describe('AssignDeviceSite: escritura dirigida', () => {
  it('solo escribe sede y zona: no deshace el contacto ni las redes guardados por otro', async () => {
    const setup = await setUp([]);
    // AssignDeviceSite carga el equipo antes; el contacto y las redes llegan en medio.
    const racingSites = {
      find: async (id: string) => {
        await setup.contact.execute(contactInput('10.0.0.1'));
        await setup.setNetworks.execute({
          deviceId: setup.device.id,
          allowedNetworks: ['10.0.0.0/8'],
        });
        return { id, timeZone: 'America/Mexico_City', active: true };
      },
    };
    const assign = new AssignDeviceSite({
      deviceRepository: setup.deviceRepository,
      deviceSiteDirectory: racingSites,
    });

    const result = await assign.execute({ deviceId: setup.device.id, siteId: SITE_ID });

    expect(result.ok).toBe(true);
    const stored = await setup.deviceRepository.findById(setup.device.id);
    expect(stored?.siteId).toBe(SITE_ID);
    expect(stored?.lastSeenIp).toBe('10.0.0.1');
    expect(stored?.allowedNetworks).toEqual(['10.0.0.0/8']);
  });
});
