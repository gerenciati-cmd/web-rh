import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
  InMemoryDeviceRepository,
  InMemoryDeviceUserRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';
import { DeviceUserSync } from '../device-user-sync';
import type { RosterMember, SiteRoster } from '../ports/site-roster';

import { SyncDevice } from './sync-device.command';

const SITE_ID = '00000000-0000-4000-8000-0000000000b1';
const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const USER_ID = '00000000-0000-4000-8000-0000000000a1';
const ANA: RosterMember = {
  employeeId: '00000000-0000-4000-8000-0000000000e1',
  fullName: 'Ana Rojas',
  rfc: 'GOMA850101AB1',
};
const BETO: RosterMember = {
  employeeId: '00000000-0000-4000-8000-0000000000e2',
  fullName: 'Beto Pérez',
  rfc: 'PEXL900215AB2',
};
const SIN_RFC: RosterMember = {
  employeeId: '00000000-0000-4000-8000-0000000000e3',
  fullName: 'Luis Antiguo',
  rfc: null,
};

async function setUp(
  options: { networks?: string[]; siteId?: string | null; active?: boolean } = {},
) {
  const store = new InMemoryAttendanceStore();
  const logger = new RecordingLogger();
  const clock = new FixedClock();
  const deviceRepository = new InMemoryDeviceRepository(store);
  const deviceCommandRepository = new InMemoryDeviceCommandRepository(store);
  const deviceUserRepository = new InMemoryDeviceUserRepository(store);
  const members: RosterMember[] = [];
  const siteRoster: SiteRoster = {
    activeMembers: () => Promise.resolve([...members]),
    findPlacement: () => Promise.resolve(null),
  };
  await deviceRepository.add(
    Device.restore(DEVICE_ID, {
      serialNumber: 'TESTSN001',
      name: 'Entrada',
      timeZone: 'America/Cancun',
      active: options.active ?? true,
      registeredAt: new Date('2026-01-15T12:00:00Z'),
      lastSeenAt: null,
      siteId: options.siteId === undefined ? SITE_ID : options.siteId,
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
      allowedNetworks: options.networks ?? ['10.0.0.0/8'],
      lastSeenIp: null,
    }),
  );
  const deviceUserSync = new DeviceUserSync({
    deviceCommandRepository,
    deviceUserRepository,
    idGenerator: new SequentialIdGenerator(),
    clock,
    logger,
  });
  const command = new SyncDevice({
    deviceRepository,
    deviceUserRepository,
    siteRoster,
    deviceUserSync,
    logger,
  });
  const queuedTexts = () => [...store.commands.values()].map((queued) => queued.command);
  return { command, store, logger, members, deviceUserRepository, queuedTexts };
}

describe('SyncDevice', () => {
  it('encola un UPDATE por cada colaborador con RFC y reporta NO_RFC sin encolarlo', async () => {
    const { command, members, store, queuedTexts } = await setUp();
    members.push(ANA, BETO, SIN_RFC);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(result.ok && result.value).toEqual({
      queued: 2,
      removed: 0,
      skipped: [{ employeeId: SIN_RFC.employeeId, fullName: 'Luis Antiguo', reason: 'NO_RFC' }],
    });
    expect(queuedTexts()).toEqual([
      `DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`,
      `DATA UPDATE USERINFO PIN=PEXL900215AB2\tName=Beto Pérez\tPri=0\tPasswd=\tCard=\tGrp=1\tTZ=0000000100000000\tVerify=0`,
    ]);
    expect([...store.commands.values()].every((queued) => queued.queuedBy === USER_ID)).toBe(true);
  });

  it('anota en el registro el PIN y el colaborador de cada alta', async () => {
    const { command, members, deviceUserRepository } = await setUp();
    members.push(ANA);

    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    const rows = await deviceUserRepository.listByDevice(DEVICE_ID);
    expect(rows.map((row) => [row.pin, row.employeeId])).toEqual([[ANA.rfc, ANA.employeeId]]);
  });

  it('repetido antes de que el equipo consulte no duplica comandos en cola', async () => {
    const { command, members, store } = await setUp();
    members.push(ANA, BETO);
    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    const second = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(second.ok && second.value.queued).toBe(0);
    expect(store.commands.size).toBe(2);
  });

  it('da de baja (DELETE) a quien el API puso y ya no es de la sede', async () => {
    const { command, members, deviceUserRepository, queuedTexts } = await setUp();
    members.push(ANA, BETO);
    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });
    members.splice(members.indexOf(BETO), 1);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(result.ok && result.value.removed).toBe(1);
    expect(queuedTexts()).toContain('DATA DELETE USERINFO PIN=PEXL900215AB2');
    expect((await deviceUserRepository.listByDevice(DEVICE_ID)).map((row) => row.pin)).toEqual([
      ANA.rfc,
    ]);
  });

  it('nunca da de baja un PIN que no está en el registro (usuarios que el API no creó)', async () => {
    const { command, members, queuedTexts } = await setUp();
    members.push(ANA);

    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(queuedTexts().some((text) => text.startsWith('DATA DELETE'))).toBe(false);
  });

  it('un colaborador sin RFC no se anota en el registro', async () => {
    const { command, members, deviceUserRepository } = await setUp();
    members.push(ANA, SIN_RFC);

    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect((await deviceUserRepository.listByDevice(DEVICE_ID)).map((row) => row.pin)).toEqual([
      ANA.rfc,
    ]);
  });

  it('equipo inexistente: DEVICE_NOT_FOUND', async () => {
    const { command } = await setUp();

    const result = await command.execute({
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      queuedBy: USER_ID,
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('equipo sin sede: DEVICE_WITHOUT_SITE y nada encolado', async () => {
    const { command, members, store } = await setUp({ siteId: null });
    members.push(ANA);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(!result.ok && result.error.code).toBe('DEVICE_WITHOUT_SITE');
    expect(store.commands.size).toBe(0);
  });

  it('equipo sin redes permitidas: DEVICE_NETWORK_UNRESTRICTED, nada encolado ni registrado', async () => {
    const { command, members, store, deviceUserRepository } = await setUp({ networks: [] });
    members.push(ANA);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(!result.ok && result.error.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
    expect(!result.ok && result.error.details).toEqual({ deviceId: DEVICE_ID });
    expect(store.commands.size).toBe(0);
    expect(await deviceUserRepository.listByDevice(DEVICE_ID)).toEqual([]);
  });

  it('equipo inactivo: responde ceros sin encolar', async () => {
    const { command, members, store } = await setUp({ active: false });
    members.push(ANA);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(result.ok && result.value).toEqual({ queued: 0, removed: 0, skipped: [] });
    expect(store.commands.size).toBe(0);
  });

  it('disparo automático (queuedBy null): comandos sin usuario y warn al rechazarse por redes', async () => {
    const withNetworks = await setUp();
    withNetworks.members.push(ANA);
    await withNetworks.command.execute({ deviceId: DEVICE_ID, queuedBy: null });
    expect([...withNetworks.store.commands.values()].map((queued) => queued.queuedBy)).toEqual([
      null,
    ]);

    const without = await setUp({ networks: [] });
    const result = await without.command.execute({ deviceId: DEVICE_ID, queuedBy: null });

    expect(!result.ok && result.error.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
    expect(without.logger.entries).toEqual([
      {
        level: 'warn',
        obj: { deviceId: DEVICE_ID, code: 'DEVICE_NETWORK_UNRESTRICTED' },
        msg: 'zkteco: checador sin redes, sincronización omitida',
      },
    ]);
  });

  it('un rechazo pedido por un usuario (queuedBy con valor) no escribe warn: lo recibe en la respuesta', async () => {
    const { command, logger } = await setUp({ networks: [] });

    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(logger.entries).toEqual([]);
  });

  it('los logs llevan conteos e ids, nunca el RFC ni el nombre', async () => {
    const { command, members, logger } = await setUp();
    members.push(ANA, SIN_RFC);

    await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { deviceId: DEVICE_ID, queued: 1, removed: 0, skipped: 1 },
        msg: 'zkteco: sincronización de checador',
      },
    ]);
    const serialized = JSON.stringify(logger.entries);
    expect(serialized).not.toContain(ANA.rfc);
    expect(serialized).not.toContain('Ana');
  });

  it('un nombre que vuelve el comando mayor a 500 caracteres se omite con warn y sin ensuciar el registro', async () => {
    const { command, members, logger, deviceUserRepository, store } = await setUp();
    members.push({ ...ANA, fullName: 'A'.repeat(600) }, BETO);

    const result = await command.execute({ deviceId: DEVICE_ID, queuedBy: USER_ID });

    expect(result.ok && result.value.queued).toBe(1);
    expect(store.commands.size).toBe(1);
    expect((await deviceUserRepository.listByDevice(DEVICE_ID)).map((row) => row.pin)).toEqual([
      BETO.rfc,
    ]);
    expect(logger.entries).toContainEqual({
      level: 'warn',
      obj: { deviceId: DEVICE_ID, employeeId: ANA.employeeId },
      msg: 'zkteco: comando de sincronización inválido',
    });
  });
});
