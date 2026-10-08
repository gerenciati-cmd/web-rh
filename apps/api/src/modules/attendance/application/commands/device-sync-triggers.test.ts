import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingEventBus, RecordingLogger } from '@/shared/testing/fakes';

import {
  DEVICE_COMMANDS_ENABLED,
  DEVICE_SITE_ASSIGNED,
  Device,
  type DeviceId,
} from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { AssignDeviceSite } from './assign-device-site.command';
import { SetDeviceNetworks } from './set-device-networks.command';

/** Los casos de uso publican los eventos que disparan la sincronización (plan 007, paso 4). */
const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const SITE_A = '00000000-0000-4000-8000-0000000000b1';
const SITE_B = '00000000-0000-4000-8000-0000000000b2';

async function setUp() {
  const deviceRepository = new InMemoryDeviceRepository(new InMemoryAttendanceStore());
  const registered = Device.register({
    id: DEVICE_ID,
    serialNumber: 'TESTSN001',
    name: 'Entrada',
    siteId: SITE_A,
    timeZone: 'America/Cancun',
    now: new Date('2026-01-15T12:00:00Z'),
  });
  if (!registered.ok) throw registered.error;
  await deviceRepository.add(registered.value);
  const eventBus = new RecordingEventBus();
  const clock = new FixedClock(new Date('2026-10-08T12:00:00Z'));
  const assign = new AssignDeviceSite({
    eventBus,
    clock,
    deviceRepository,
    deviceSiteDirectory: {
      find: (id: string) => Promise.resolve({ id, timeZone: 'America/Mexico_City', active: true }),
    },
  });
  const setNetworks = new SetDeviceNetworks({
    eventBus,
    clock,
    deviceRepository,
    logger: new RecordingLogger(),
  });
  return { assign, setNetworks, eventBus };
}

describe('AssignDeviceSite: eventos', () => {
  it('publica DEVICE_SITE_ASSIGNED con la hora del reloj cuando la sede cambia', async () => {
    const { assign, eventBus } = await setUp();

    await assign.execute({ deviceId: DEVICE_ID, siteId: SITE_B });

    expect(eventBus.names()).toEqual([DEVICE_SITE_ASSIGNED]);
    expect(eventBus.published[0]?.payload).toEqual({
      deviceId: DEVICE_ID,
      siteId: SITE_B,
      previousSiteId: SITE_A,
    });
    expect(eventBus.published[0]?.occurredAt).toEqual(new Date('2026-10-08T12:00:00Z'));
  });

  it('no publica nada si la sede es la misma', async () => {
    const { assign, eventBus } = await setUp();

    const result = await assign.execute({ deviceId: DEVICE_ID, siteId: SITE_A });

    expect(result.ok).toBe(true);
    expect(eventBus.published).toEqual([]);
  });

  it('no publica nada si el equipo no existe', async () => {
    const { assign, eventBus } = await setUp();

    await assign.execute({ deviceId: '00000000-0000-4000-8000-0000000000ff', siteId: SITE_B });

    expect(eventBus.published).toEqual([]);
  });
});

describe('SetDeviceNetworks: eventos', () => {
  it('publica DEVICE_COMMANDS_ENABLED al pasar de sin redes a con redes', async () => {
    const { setNetworks, eventBus } = await setUp();

    await setNetworks.execute({ deviceId: DEVICE_ID, allowedNetworks: ['10.0.0.0/8'] });

    expect(eventBus.names()).toEqual([DEVICE_COMMANDS_ENABLED]);
    expect(eventBus.published[0]?.payload).toEqual({ deviceId: DEVICE_ID });
  });

  it('no vuelve a publicar al reemplazar las redes ni al vaciarlas', async () => {
    const { setNetworks, eventBus } = await setUp();
    await setNetworks.execute({ deviceId: DEVICE_ID, allowedNetworks: ['10.0.0.0/8'] });

    await setNetworks.execute({ deviceId: DEVICE_ID, allowedNetworks: ['192.168.0.0/16'] });
    await setNetworks.execute({ deviceId: DEVICE_ID, allowedNetworks: [] });

    expect(eventBus.names()).toEqual([DEVICE_COMMANDS_ENABLED]);
  });

  it('una lista inválida no publica nada', async () => {
    const { setNetworks, eventBus } = await setUp();

    const result = await setNetworks.execute({
      deviceId: DEVICE_ID,
      allowedNetworks: ['10.0.0.0/33'],
    });

    expect(result.ok).toBe(false);
    expect(eventBus.published).toEqual([]);
  });
});
