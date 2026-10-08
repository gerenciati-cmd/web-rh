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
import type { SiteRoster } from '../ports/site-roster';

import { SyncEmployee } from './sync-employee.command';

const SITE_S = '00000000-0000-4000-8000-0000000000b1';
const SITE_T = '00000000-0000-4000-8000-0000000000b2';
const EMPLOYEE_ID = '00000000-0000-4000-8000-0000000000e1';
const RFC = 'GOMA850101AB1';
const NEW_RFC = 'GOMA850101ZZ9';
const DEVICE_S1 = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const DEVICE_S2 = '00000000-0000-4000-8000-0000000000d2' as DeviceId;
const DEVICE_T1 = '00000000-0000-4000-8000-0000000000d3' as DeviceId;

interface Placement {
  rfc: string | null;
  siteId: string | null;
  active: boolean;
  fullName: string;
}

async function setUp() {
  const store = new InMemoryAttendanceStore();
  const logger = new RecordingLogger();
  const deviceRepository = new InMemoryDeviceRepository(store);
  const deviceCommandRepository = new InMemoryDeviceCommandRepository(store);
  const deviceUserRepository = new InMemoryDeviceUserRepository(store);
  let placement: Placement | null = {
    rfc: RFC,
    siteId: SITE_S,
    active: true,
    fullName: 'Ana Rojas',
  };
  const siteRoster: SiteRoster = {
    activeMembers: () => Promise.resolve([]),
    findPlacement: () =>
      Promise.resolve(
        placement
          ? {
              member: {
                employeeId: EMPLOYEE_ID,
                fullName: placement.fullName,
                rfc: placement.rfc,
              },
              siteId: placement.siteId,
              active: placement.active,
            }
          : null,
      ),
  };
  const addDevice = (
    id: DeviceId,
    name: string,
    siteId: string | null,
    options: { networks?: string[]; active?: boolean } = {},
  ) =>
    deviceRepository.add(
      Device.restore(id, {
        serialNumber: `SN${name}`,
        name,
        timeZone: 'America/Cancun',
        active: options.active ?? true,
        registeredAt: new Date('2026-01-15T12:00:00Z'),
        lastSeenAt: null,
        siteId,
        clockOffsetSeconds: null,
        clockOffsetMeasuredAt: null,
        allowedNetworks: options.networks ?? ['10.0.0.0/8'],
        lastSeenIp: null,
      }),
    );
  await addDevice(DEVICE_S1, 'S1', SITE_S);
  await addDevice(DEVICE_S2, 'S2', SITE_S);
  await addDevice(DEVICE_T1, 'T1', SITE_T);
  const deviceUserSync = new DeviceUserSync({
    deviceCommandRepository,
    deviceUserRepository,
    idGenerator: new SequentialIdGenerator(),
    clock: new FixedClock(),
    logger,
  });
  const command = new SyncEmployee({
    deviceRepository,
    deviceUserRepository,
    siteRoster,
    deviceUserSync,
    logger,
  });
  const commandsOf = (deviceId: DeviceId) =>
    [...store.commands.values()]
      .filter((queued) => queued.deviceId === deviceId)
      .map((queued) => queued.command);
  return {
    command,
    store,
    logger,
    addDevice,
    deviceUserRepository,
    commandsOf,
    setPlacement: (next: Placement | null) => {
      placement = next;
    },
  };
}

const upsert = (rfc: string): unknown =>
  expect.stringContaining(`DATA UPDATE USERINFO PIN=${rfc}\t`);
const remove = (rfc: string) => `DATA DELETE USERINFO PIN=${rfc}`;

describe('SyncEmployee', () => {
  it('alta: un UPDATE en cada equipo activo con redes de su sede, y ninguno en otra sede', async () => {
    const { command, commandsOf, store } = await setUp();

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC)]);
    expect(commandsOf(DEVICE_S2)).toEqual([upsert(RFC)]);
    expect(commandsOf(DEVICE_T1)).toEqual([]);
    expect([...store.commands.values()].every((queued) => queued.queuedBy === null)).toBe(true);
  });

  it('es idempotente: repetir el evento no encola ni registra de nuevo', async () => {
    const { command, store } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(store.commands.size).toBe(2);
  });

  it('ignora equipos inactivos de la sede', async () => {
    const { command, addDevice, commandsOf } = await setUp();
    const inactive = '00000000-0000-4000-8000-0000000000d9' as DeviceId;
    await addDevice(inactive, 'Z', SITE_S, { active: false });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(inactive)).toEqual([]);
  });

  it('cambio de sede: DELETE en los equipos de la sede anterior y UPDATE en los de la nueva', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_T, active: true, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC)]);
    expect(commandsOf(DEVICE_S2)).toEqual([upsert(RFC), remove(RFC)]);
    expect(commandsOf(DEVICE_T1)).toEqual([upsert(RFC)]);
    expect((await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).map((r) => r.deviceId)).toEqual(
      [DEVICE_T1],
    );
  });

  it('cambio de RFC: DELETE del PIN viejo y UPDATE del nuevo en cada equipo', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: NEW_RFC, siteId: SITE_S, active: true, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC), upsert(NEW_RFC)]);
    expect((await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).map((r) => r.pin)).toEqual([
      NEW_RFC,
      NEW_RFC,
    ]);
  });

  it('baja (colaborador inactivo): DELETE de su PIN en todos los equipos donde el API lo puso', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_S, active: false, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC)]);
    expect(commandsOf(DEVICE_S2)).toEqual([upsert(RFC), remove(RFC)]);
    expect(await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).toEqual([]);
  });

  it('colaborador que ya no existe en employees: se da de baja de donde el API lo puso', async () => {
    const { command, setPlacement, commandsOf } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement(null);

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC)]);
  });

  it('colaborador sin RFC o sin sede: no se encola nada', async () => {
    const { command, setPlacement, store } = await setUp();
    setPlacement({ rfc: null, siteId: SITE_S, active: true, fullName: 'Luis Antiguo' });
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: null, active: true, fullName: 'Ana Rojas' });
    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(store.commands.size).toBe(0);
  });

  it('un equipo sin redes se omite (sin comando ni fila) y deja un warn por equipo con ids', async () => {
    const { command, addDevice, commandsOf, deviceUserRepository, logger } = await setUp();
    const bare = '00000000-0000-4000-8000-0000000000d8' as DeviceId;
    await addDevice(bare, 'B', SITE_S, { networks: [] });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(bare)).toEqual([]);
    expect((await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).map((r) => r.deviceId)).toEqual(
      [DEVICE_S1, DEVICE_S2],
    );
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { deviceId: bare, employeeId: EMPLOYEE_ID },
        msg: 'zkteco: checador sin redes, sincronización omitida',
      },
    ]);
  });

  it('un equipo sin redes tampoco recibe la baja: su fila queda para cuando se habilite', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository, store } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    // Las redes se vacían después del alta: el equipo ya no recibe comandos.
    for (const device of [...store.devices.values()]) device.setAllowedNetworks([], new Date());
    setPlacement({ rfc: RFC, siteId: SITE_S, active: false, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC)]);
    expect(await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).toHaveLength(2);
  });

  it('un registro de un equipo que ya no existe se ignora sin fallar', async () => {
    const { command, setPlacement, deviceUserRepository, store } = await setUp();
    await deviceUserRepository.put({
      deviceId: '00000000-0000-4000-8000-0000000000f0' as DeviceId,
      pin: RFC,
      employeeId: EMPLOYEE_ID,
      syncedAt: new Date(),
    });
    setPlacement(null);

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(store.commands.size).toBe(0);
  });

  // Hallazgo 1 de la revisión (decisión 21): la entrega es FIFO, así que manda el ÚLTIMO comando
  // en cola de cada PIN, no la existencia de uno idéntico.
  it('caso B: S → T → S con la cola sin vaciar deja el UPDATE final y el registro de vuelta en S', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_T, active: true, fullName: 'Ana Rojas' });
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_S, active: true, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC), upsert(RFC)]);
    expect(commandsOf(DEVICE_S2)).toEqual([upsert(RFC), remove(RFC), upsert(RFC)]);
    expect(
      (await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).map((row) => row.deviceId).sort(),
    ).toEqual([DEVICE_S1, DEVICE_S2]);
  });

  it('caso A: sale, vuelve y sale otra vez antes de que el equipo consulte: el DELETE final se encola', async () => {
    const { command, setPlacement, commandsOf, deviceUserRepository, store } = await setUp();
    await command.execute({ employeeId: EMPLOYEE_ID });
    // El alta ya se entregó (el colaborador está en el equipo): nada de ese comando sigue en cola.
    for (const queued of store.commands.values()) queued.markSent(new Date());
    setPlacement({ rfc: RFC, siteId: SITE_T, active: true, fullName: 'Ana Rojas' });
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_S, active: true, fullName: 'Ana Rojas' });
    await command.execute({ employeeId: EMPLOYEE_ID });
    setPlacement({ rfc: RFC, siteId: SITE_T, active: true, fullName: 'Ana Rojas' });

    await command.execute({ employeeId: EMPLOYEE_ID });

    expect(commandsOf(DEVICE_S1)).toEqual([upsert(RFC), remove(RFC), upsert(RFC), remove(RFC)]);
    expect(commandsOf(DEVICE_S2)).toEqual([upsert(RFC), remove(RFC), upsert(RFC), remove(RFC)]);
    expect((await deviceUserRepository.listByEmployee(EMPLOYEE_ID)).map((r) => r.deviceId)).toEqual(
      [DEVICE_T1],
    );
  });
});
