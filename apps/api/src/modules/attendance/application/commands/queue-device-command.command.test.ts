import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
  InMemoryDeviceRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { QueueDeviceCommand } from './queue-device-command.command';

const COMMAND = 'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas';
const QUEUED_BY = '00000000-0000-4000-8000-0000000000a1';

async function setUp() {
  const store = new InMemoryAttendanceStore();
  const logger = new RecordingLogger();
  const clock = new FixedClock();
  const idGenerator = new SequentialIdGenerator();
  const deviceRepository = new InMemoryDeviceRepository(store);
  const deviceCommandRepository = new InMemoryDeviceCommandRepository(store);
  const registered = Device.register({
    id: idGenerator.next() as DeviceId,
    serialNumber: 'TESTSN001',
    name: 'Entrada',
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: clock.now(),
  });
  if (!registered.ok) throw registered.error;
  await deviceRepository.save(registered.value);
  return {
    store,
    logger,
    clock,
    device: registered.value,
    command: new QueueDeviceCommand({
      deviceRepository,
      deviceCommandRepository,
      idGenerator,
      clock,
      logger,
    }),
  };
}

describe('QueueDeviceCommand', () => {
  it('encola el comando como QUEUED y devuelve su id', async () => {
    const { command, device, store, clock } = await setUp();

    const result = await command.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = store.commands.get(result.value.id);
    expect(saved?.status).toBe('QUEUED');
    expect(saved?.command).toBe(COMMAND);
    expect(saved?.deviceId).toBe(device.id);
    expect(saved?.queuedBy).toBe(QUEUED_BY);
    expect(saved?.queuedAt).toEqual(clock.now());
    // Plan 006: el API asigna el número C:<n>: a partir de deviceCommandRepository.nextNumber().
    expect(saved?.number).toBe(1);
  });

  it('asigna números consecutivos a comandos sucesivos', async () => {
    const { command, device, store } = await setUp();

    const first = await command.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });
    const second = await command.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(first.ok && store.commands.get(first.value.id)?.number).toBe(1);
    expect(second.ok && store.commands.get(second.value.id)?.number).toBe(2);
  });

  it('registra el encolado sin el texto del comando (puede llevar un PIN o un nombre)', async () => {
    const { command, device, logger } = await setUp();

    const result = await command.execute({
      deviceId: device.id,
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { serialNumber: 'TESTSN001', commandId: result.value.id, number: 1 },
        msg: 'zkteco: comando encolado',
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('GOMA850101AB1');
  });

  it('equipo inexistente: DEVICE_NOT_FOUND y nada encolado', async () => {
    const { command, store } = await setUp();

    const result = await command.execute({
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      command: COMMAND,
      queuedBy: QUEUED_BY,
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_FOUND');
    expect(store.commands.size).toBe(0);
  });

  it('un comando fuera de la familia USERINFO: INVALID_VALUE y nada encolado', async () => {
    const { command, device, store, logger } = await setUp();

    const result = await command.execute({
      deviceId: device.id,
      command: 'CLEAR DATA',
      queuedBy: QUEUED_BY,
    });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(store.commands.size).toBe(0);
    expect(logger.entries).toEqual([]);
  });
});
