import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger } from '@/shared/testing/fakes';

import type { DeviceId } from '../../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../../domain/device-command';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { TakeDeviceCommand } from './take-device-command.command';

const DEVICE = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const OTHER_DEVICE = '00000000-0000-4000-8000-0000000000d2' as DeviceId;

function setUp() {
  const store = new InMemoryAttendanceStore();
  const repository = new InMemoryDeviceCommandRepository(store);
  const logger = new RecordingLogger();
  const clock = new FixedClock();

  async function queue(n: number, deviceId: DeviceId, queuedAt: Date): Promise<DeviceCommandId> {
    const id = `00000000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}` as DeviceCommandId;
    const result = DeviceCommand.queue({
      id,
      deviceId,
      command: `DATA QUERY USERINFO PIN=${n}`,
      queuedBy: '00000000-0000-4000-8000-0000000000a1',
      now: queuedAt,
    });
    if (!result.ok) throw result.error;
    await repository.save(result.value);
    return id;
  }

  return {
    store,
    logger,
    clock,
    queue,
    take: new TakeDeviceCommand({ deviceCommandRepository: repository, clock, logger }),
  };
}

describe('TakeDeviceCommand', () => {
  it('sin comandos en cola devuelve null y no registra nada', async () => {
    const { take, logger } = setUp();

    expect(await take.execute({ deviceId: DEVICE })).toBeNull();
    expect(logger.entries).toEqual([]);
  });

  it('entrega primero el comando más antiguo y cada uno una sola vez', async () => {
    const { take, queue, store } = setUp();
    const newer = await queue(2, DEVICE, new Date('2026-10-02T12:05:00Z'));
    const older = await queue(1, DEVICE, new Date('2026-10-02T12:00:00Z'));

    expect(await take.execute({ deviceId: DEVICE })).toBe('DATA QUERY USERINFO PIN=1');
    expect(await take.execute({ deviceId: DEVICE })).toBe('DATA QUERY USERINFO PIN=2');
    expect(await take.execute({ deviceId: DEVICE })).toBeNull();
    expect(store.commands.get(older)?.status).toBe('SENT');
    expect(store.commands.get(newer)?.status).toBe('SENT');
  });

  it('marca el comando SENT con la hora del reloj y registra la entrega sin el texto', async () => {
    const { take, queue, store, clock, logger } = setUp();
    const id = await queue(1, DEVICE, new Date('2026-10-02T12:00:00Z'));
    const deliveredAt = new Date('2026-10-02T12:00:10Z');
    clock.set(deliveredAt);

    await take.execute({ deviceId: DEVICE });

    expect(store.commands.get(id)?.sentAt).toEqual(deliveredAt);
    expect(logger.entries).toEqual([
      {
        level: 'info',
        obj: { deviceId: DEVICE, commandId: id },
        msg: 'zkteco: comando entregado',
      },
    ]);
  });

  it('no entrega comandos de otro equipo', async () => {
    const { take, queue, store } = setUp();
    const other = await queue(1, OTHER_DEVICE, new Date('2026-10-02T12:00:00Z'));

    expect(await take.execute({ deviceId: DEVICE })).toBeNull();
    expect(store.commands.get(other)?.status).toBe('QUEUED');
  });
});
