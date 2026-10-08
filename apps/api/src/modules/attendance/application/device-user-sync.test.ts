import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
  InMemoryDeviceUserRepository,
} from '../infrastructure/in-memory/in-memory-attendance.store';

import { DeviceUserSync } from './device-user-sync';

/** Compuerta de la barrera de red (decisión 16): vive en el helper, no solo en los casos de uso. */
const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const MEMBER = {
  employeeId: '00000000-0000-4000-8000-0000000000e1',
  fullName: 'Ana Rojas',
  rfc: 'GOMA850101AB1',
};
const NOW = new Date('2026-10-08T12:00:00Z');

function device(networks: string[]): Device {
  return Device.restore(DEVICE_ID, {
    serialNumber: 'TESTSN001',
    name: 'Entrada',
    timeZone: 'America/Cancun',
    active: true,
    registeredAt: new Date('2026-01-15T12:00:00Z'),
    lastSeenAt: null,
    siteId: '00000000-0000-4000-8000-0000000000b1',
    clockOffsetSeconds: null,
    clockOffsetMeasuredAt: null,
    allowedNetworks: networks,
    lastSeenIp: null,
  });
}

function setUp() {
  const store = new InMemoryAttendanceStore();
  const logger = new RecordingLogger();
  const deviceUserRepository = new InMemoryDeviceUserRepository(store);
  const sync = new DeviceUserSync({
    deviceCommandRepository: new InMemoryDeviceCommandRepository(store),
    deviceUserRepository,
    idGenerator: new SequentialIdGenerator(),
    clock: new FixedClock(NOW),
    logger,
  });
  return { sync, store, logger, deviceUserRepository };
}

describe('DeviceUserSync: compuerta de la barrera de red', () => {
  it('push a un equipo sin redes devuelve unrestricted sin encolar ni tocar el registro', async () => {
    const { sync, store, deviceUserRepository } = setUp();

    const outcome = await sync.push(device([]), MEMBER, null);

    expect(outcome).toBe('unrestricted');
    expect(store.commands.size).toBe(0);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toEqual([]);
  });

  it('remove a un equipo sin redes devuelve unrestricted y conserva la fila del registro', async () => {
    const { sync, store, deviceUserRepository } = setUp();
    await deviceUserRepository.put({
      deviceId: DEVICE_ID,
      pin: MEMBER.rfc,
      employeeId: MEMBER.employeeId,
      syncedAt: NOW,
    });

    const outcome = await sync.remove(
      device([]),
      { pin: MEMBER.rfc, employeeId: MEMBER.employeeId },
      null,
    );

    expect(outcome).toBe('unrestricted');
    expect(store.commands.size).toBe(0);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toHaveLength(1);
  });
});

describe('DeviceUserSync: con redes', () => {
  it('push encola el UPDATE con número, sin usuario, y anota el registro con la hora del reloj', async () => {
    const { sync, store, deviceUserRepository } = setUp();

    const outcome = await sync.push(device(['10.0.0.0/8']), MEMBER, null);

    expect(outcome).toBe('queued');
    const [queued] = [...store.commands.values()];
    expect(queued?.number).toBe(1);
    expect(queued?.queuedBy).toBeNull();
    expect(queued?.status).toBe('QUEUED');
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toEqual([
      { deviceId: DEVICE_ID, pin: MEMBER.rfc, employeeId: MEMBER.employeeId, syncedAt: NOW },
    ]);
  });

  it('un comando idéntico en cola da duplicate: no se encola otro y el registro se mantiene', async () => {
    const { sync, store, deviceUserRepository } = setUp();
    await sync.push(device(['10.0.0.0/8']), MEMBER, null);

    const outcome = await sync.push(device(['10.0.0.0/8']), MEMBER, null);

    expect(outcome).toBe('duplicate');
    expect(store.commands.size).toBe(1);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toHaveLength(1);
  });

  it('un comando idéntico que ya salió de la cola (SENT) sí se vuelve a encolar', async () => {
    const { sync, store } = setUp();
    await sync.push(device(['10.0.0.0/8']), MEMBER, null);
    const [first] = [...store.commands.values()];
    first?.markSent(NOW);

    const outcome = await sync.push(device(['10.0.0.0/8']), MEMBER, null);

    expect(outcome).toBe('queued');
    expect(store.commands.size).toBe(2);
  });

  it('remove encola el DELETE y quita la fila del registro', async () => {
    const { sync, store, deviceUserRepository } = setUp();
    await sync.push(device(['10.0.0.0/8']), MEMBER, null);

    const outcome = await sync.remove(
      device(['10.0.0.0/8']),
      { pin: MEMBER.rfc, employeeId: MEMBER.employeeId },
      null,
    );

    expect(outcome).toBe('queued');
    expect([...store.commands.values()].map((queued) => queued.command)).toContain(
      'DATA DELETE USERINFO PIN=GOMA850101AB1',
    );
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toEqual([]);
  });

  it('un texto inválido (más de 500 caracteres) da invalid, avisa con ids y no toca el registro', async () => {
    const { sync, store, logger, deviceUserRepository } = setUp();

    const outcome = await sync.push(
      device(['10.0.0.0/8']),
      { ...MEMBER, fullName: 'A'.repeat(600) },
      null,
    );

    expect(outcome).toBe('invalid');
    expect(store.commands.size).toBe(0);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toEqual([]);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { deviceId: DEVICE_ID, employeeId: MEMBER.employeeId },
        msg: 'zkteco: comando de sincronización inválido',
      },
    ]);
  });

  it('si el último comando en cola del PIN es el contrario, el idéntico más viejo no cuenta: se encola', async () => {
    const { sync, store, deviceUserRepository } = setUp();
    const online = device(['10.0.0.0/8']);
    await sync.push(online, MEMBER, null);
    await sync.remove(online, { pin: MEMBER.rfc, employeeId: MEMBER.employeeId }, null);

    const outcome = await sync.push(online, MEMBER, null);

    expect(outcome).toBe('queued');
    expect([...store.commands.values()].map((queued) => queued.command.split('\t')[0])).toEqual([
      'DATA UPDATE USERINFO PIN=GOMA850101AB1',
      'DATA DELETE USERINFO PIN=GOMA850101AB1',
      'DATA UPDATE USERINFO PIN=GOMA850101AB1',
    ]);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toHaveLength(1);
  });

  it('con el DELETE como último en cola, repetir el DELETE es duplicate aunque haya un UPDATE anterior', async () => {
    const { sync, store } = setUp();
    const online = device(['10.0.0.0/8']);
    const user = { pin: MEMBER.rfc, employeeId: MEMBER.employeeId };
    await sync.push(online, MEMBER, null);
    await sync.remove(online, user, null);

    const outcome = await sync.remove(online, user, null);

    expect(outcome).toBe('duplicate');
    expect(store.commands.size).toBe(2);
  });
});
