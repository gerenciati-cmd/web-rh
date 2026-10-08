import { describe, expect, it } from 'vitest';

import type { DeviceId } from '../../domain/device';
import { DeviceCommand, type DeviceCommandId } from '../../domain/device-command';
import { deleteUserCommand, upsertUserCommand } from '../../domain/device-user-commands';

import {
  InMemoryAttendanceStore,
  InMemoryDeviceCommandRepository,
} from './in-memory-attendance.store';

const DEVICE_1 = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const DEVICE_2 = '00000000-0000-4000-8000-0000000000d2' as DeviceId;
const PIN = 'GOMA850101AB1';
const T0 = new Date('2026-10-08T12:00:00Z');
const T1 = new Date('2026-10-08T12:00:05Z');
const UPDATE = upsertUserCommand(PIN, 'Ana Rojas');
const DELETE = deleteUserCommand(PIN);

// Mismo contrato que `PrismaDeviceCommandRepository.lastQueuedForPin` (ver
// prisma-device-user.int.test.ts): el último comando en cola de ese PIN en ese equipo.
describe('InMemoryDeviceCommandRepository.lastQueuedForPin', () => {
  let counter = 0;

  function setUp() {
    const store = new InMemoryAttendanceStore();
    const repository = new InMemoryDeviceCommandRepository(store);
    const queue = async (
      text: string,
      options: { deviceId?: DeviceId; at?: Date; id?: string } = {},
    ) => {
      counter += 1;
      const created = DeviceCommand.queue({
        id: (options.id ??
          `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`) as DeviceCommandId,
        deviceId: options.deviceId ?? DEVICE_1,
        number: await repository.nextNumber(),
        command: text,
        queuedBy: null,
        now: options.at ?? T0,
      });
      if (!created.ok) throw created.error;
      await repository.save(created.value);
      return created.value;
    };
    return { repository, queue };
  }

  it('sin comandos del PIN devuelve null', async () => {
    const { repository } = setUp();

    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBeNull();
  });

  it('devuelve el más reciente por fecha de encolado, sea alta o baja', async () => {
    const { repository, queue } = setUp();
    await queue(UPDATE, { at: T0 });
    await queue(DELETE, { at: T1 });
    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBe(DELETE);

    await queue(UPDATE, { at: new Date('2026-10-08T12:00:10Z') });
    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBe(UPDATE);
  });

  it('con la misma fecha de encolado desempata el id mayor, inverso del orden de entrega', async () => {
    const { repository, queue } = setUp();
    await queue(UPDATE, { id: '00000000-0000-4000-8000-0000000000a2' });
    await queue(DELETE, { id: '00000000-0000-4000-8000-0000000000a1' });

    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBe(UPDATE);
  });

  it('ignora otro equipo, otro PIN (incluido uno que contiene al PIN como prefijo) y comandos que no son alta ni baja', async () => {
    const { repository, queue } = setUp();
    await queue(DELETE, { deviceId: DEVICE_2, at: T1 });
    await queue(upsertUserCommand(`${PIN}X`, 'Otra Persona'), { at: T1 });
    await queue(deleteUserCommand('PEXL900215AB2'), { at: T1 });
    await queue(`DATA QUERY USERINFO PIN=${PIN}`, { at: T1 });
    await queue(UPDATE, { at: T0 });

    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBe(UPDATE);
  });

  it('un comando que ya salió de la cola no cuenta: vuelve a mandar el anterior en cola', async () => {
    const { repository, queue } = setUp();
    await queue(UPDATE, { at: T0 });
    const sent = await queue(DELETE, { at: T1 });
    sent.markSent(T1);

    expect(await repository.lastQueuedForPin(DEVICE_1, PIN)).toBe(UPDATE);
  });
});
