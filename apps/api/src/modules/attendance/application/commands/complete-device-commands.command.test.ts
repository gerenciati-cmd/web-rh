import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger } from '@/shared/testing/fakes';

import type { DeviceId } from '../../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../../domain/device-command';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { CompleteDeviceCommands } from './complete-device-commands.command';

const DEVICE = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const OTHER_DEVICE = '00000000-0000-4000-8000-0000000000d2' as DeviceId;

function setUp() {
  const store = new InMemoryAttendanceStore();
  const repository = new InMemoryDeviceCommandRepository(store);
  const logger = new RecordingLogger();
  const clock = new FixedClock();

  async function sentCommand(
    number: number,
    deviceId: DeviceId = DEVICE,
  ): Promise<DeviceCommandId> {
    const id =
      `00000000-0000-4000-8000-0000000001${String(number).padStart(2, '0')}` as DeviceCommandId;
    const result = DeviceCommand.queue({
      id,
      deviceId,
      number,
      command: `DATA QUERY USERINFO PIN=${number}`,
      queuedBy: '00000000-0000-4000-8000-0000000000a1',
      now: new Date('2026-10-02T12:00:00Z'),
    });
    if (!result.ok) throw result.error;
    result.value.markSent(new Date('2026-10-02T12:00:05Z'));
    await repository.save(result.value);
    return id;
  }

  return {
    store,
    logger,
    clock,
    sentCommand,
    complete: new CompleteDeviceCommands({ deviceCommandRepository: repository, clock, logger }),
  };
}

describe('CompleteDeviceCommands', () => {
  it('Return=0 deja el comando DONE y lo registra a nivel info sin el texto del comando', async () => {
    const { complete, sentCommand, store, clock, logger } = setUp();
    const id = await sentCommand(1);
    const completedAt = new Date('2026-10-02T12:00:10Z');
    clock.set(completedAt);

    await complete.execute({ deviceId: DEVICE, body: 'ID=1&Return=0&CMD=DATA' });

    const command = store.commands.get(id);
    expect(command?.status).toBe('DONE');
    expect(command?.returnCode).toBe('0');
    expect(command?.completedAt).toEqual(completedAt);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { deviceId: DEVICE, commandId: id, number: 1, status: 'DONE', returnCode: '0' },
        msg: 'zkteco: comando completado',
      },
    ]);
    expect(JSON.stringify(logger.entries)).not.toContain('DATA QUERY USERINFO');
  });

  it('un Return distinto de 0 deja el comando FAILED y lo registra a nivel warn', async () => {
    const { complete, sentCommand, store, logger } = setUp();
    const id = await sentCommand(2);

    await complete.execute({ deviceId: DEVICE, body: 'ID=2&Return=-1&CMD=DATA' });

    expect(store.commands.get(id)?.status).toBe('FAILED');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { deviceId: DEVICE, commandId: id, number: 2, status: 'FAILED', returnCode: '-1' },
        msg: 'zkteco: comando completado',
      },
    ]);
  });

  it('un ID sin comando conocido para ese equipo: warn "resultado sin comando" y nada se guarda', async () => {
    const { complete, logger, store } = setUp();

    await complete.execute({ deviceId: DEVICE, body: 'ID=99&Return=0&CMD=DATA' });

    expect(store.commands.size).toBe(0);
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { deviceId: DEVICE, number: 99 },
        msg: 'zkteco: resultado sin comando',
      },
    ]);
  });

  it('un ID que existe pero es de otro equipo cuenta como desconocido', async () => {
    const { complete, sentCommand, store, logger } = setUp();
    const id = await sentCommand(3, OTHER_DEVICE);

    await complete.execute({ deviceId: DEVICE, body: 'ID=3&Return=0&CMD=DATA' });

    expect(store.commands.get(id)?.status).toBe('SENT');
    expect(logger.entries).toEqual([
      { level: 'warn', obj: { deviceId: DEVICE, number: 3 }, msg: 'zkteco: resultado sin comando' },
    ]);
  });

  it('una respuesta repetida sobre un comando ya cerrado no vuelve a guardar ni a registrar', async () => {
    const { complete, sentCommand, store, logger } = setUp();
    const id = await sentCommand(4);
    await complete.execute({ deviceId: DEVICE, body: 'ID=4&Return=0&CMD=DATA' });
    const completedAt = store.commands.get(id)?.completedAt;

    await complete.execute({ deviceId: DEVICE, body: 'ID=4&Return=0&CMD=DATA' });

    expect(store.commands.get(id)?.completedAt).toEqual(completedAt);
    expect(logger.entries.filter((e) => e.msg === 'zkteco: comando completado')).toHaveLength(1);
  });

  it('un cuerpo con dos líneas cierra cada comando correspondiente', async () => {
    const { complete, sentCommand, store } = setUp();
    const a = await sentCommand(5);
    const b = await sentCommand(6);

    await complete.execute({
      deviceId: DEVICE,
      body: 'ID=5&Return=0&CMD=DATA\nID=6&Return=-2&CMD=DATA',
    });

    expect(store.commands.get(a)?.status).toBe('DONE');
    expect(store.commands.get(b)?.status).toBe('FAILED');
  });

  it('un ID con forma inválida (no numérico o demasiado largo) se ignora', async () => {
    const { complete, logger } = setUp();

    await complete.execute({ deviceId: DEVICE, body: 'ID=abc&Return=0\nID=1234567890&Return=0' });

    expect(logger.entries).toEqual([]);
  });

  it('un cuerpo vacío no hace nada', async () => {
    const { complete, logger, store } = setUp();

    await complete.execute({ deviceId: DEVICE, body: '' });

    expect(logger.entries).toEqual([]);
    expect(store.commands.size).toBe(0);
  });
});
