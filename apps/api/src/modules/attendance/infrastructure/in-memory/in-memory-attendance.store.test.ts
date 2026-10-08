import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '../../domain/device';

import { InMemoryAttendanceStore, InMemoryDeviceRepository } from './in-memory-attendance.store';

const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1' as DeviceId;

const BASE_PROPS = {
  serialNumber: 'TESTSN001',
  name: 'Entrada',
  timeZone: 'UTC',
  active: true,
  registeredAt: new Date('2026-01-15T12:00:00Z'),
  lastSeenAt: null,
  siteId: null,
  clockOffsetSeconds: null,
  clockOffsetMeasuredAt: null,
  allowedNetworks: [],
  lastSeenIp: null,
};

/**
 * `InMemoryDeviceRepository.saveContact`/`saveSite` (plan attendance-marcaciones/005, hallazgo
 * `attendance-escritura-completa-del-equipo`): cada escritor cambia solo sus columnas, así que un
 * objeto de dominio cargado antes del cambio del otro escritor no lo pisa al guardar después.
 */
describe('InMemoryDeviceRepository — escritura dirigida', () => {
  function setUp() {
    const store = new InMemoryAttendanceStore();
    const repository = new InMemoryDeviceRepository(store);
    store.devices.set(DEVICE_ID, Device.restore(DEVICE_ID, BASE_PROPS));
    return { store, repository };
  }

  it('saveContact escribe lastSeenAt y el desfase, pero no toca siteId ni timeZone', async () => {
    const { store, repository } = setUp();
    // Snapshot cargado ya con sede asignada por otro escritor (admin), que este objeto desconoce.
    store.devices.set(
      DEVICE_ID,
      Device.restore(DEVICE_ID, {
        ...BASE_PROPS,
        siteId: '00000000-0000-4000-8000-0000000000a1',
        timeZone: 'America/Cancun',
      }),
    );
    const stalePush = Device.restore(DEVICE_ID, BASE_PROPS);
    const seenAt = new Date('2026-01-15T12:05:00Z');
    stalePush.markSeen(seenAt, null);
    stalePush.recordClockOffset(5, seenAt);

    await repository.saveContact(stalePush);

    const saved = await repository.findById(DEVICE_ID);
    expect(saved?.lastSeenAt).toEqual(seenAt);
    expect(saved?.clockOffsetSeconds).toBe(5);
    expect(saved?.siteId).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(saved?.timeZone).toBe('America/Cancun');
  });

  it('saveSite escribe siteId y timeZone, pero no toca lastSeenAt ni el desfase', async () => {
    const { store, repository } = setUp();
    // Snapshot cargado con actividad ya anotada por el tráfico del equipo, que este objeto desconoce.
    const seenAt = new Date('2026-01-15T12:05:00Z');
    store.devices.set(
      DEVICE_ID,
      Device.restore(DEVICE_ID, {
        ...BASE_PROPS,
        lastSeenAt: seenAt,
        clockOffsetSeconds: 5,
        clockOffsetMeasuredAt: seenAt,
      }),
    );
    const staleAdmin = Device.restore(DEVICE_ID, BASE_PROPS);
    staleAdmin.assignSite('00000000-0000-4000-8000-0000000000a1', 'America/Cancun');

    await repository.saveSite(staleAdmin);

    const saved = await repository.findById(DEVICE_ID);
    expect(saved?.siteId).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(saved?.timeZone).toBe('America/Cancun');
    expect(saved?.lastSeenAt).toEqual(seenAt);
    expect(saved?.clockOffsetSeconds).toBe(5);
  });

  it('la carrera se resuelve igual en cualquier orden: sede nueva y actividad de B coexisten', async () => {
    for (const order of ['site-primero', 'activity-primero'] as const) {
      const { store, repository } = setUp();
      const a = Device.restore(DEVICE_ID, BASE_PROPS);
      const b = Device.restore(DEVICE_ID, BASE_PROPS);
      a.assignSite('00000000-0000-4000-8000-0000000000a1', 'America/Mexico_City');
      const seenAt = new Date('2026-01-15T12:05:00Z');
      b.markSeen(seenAt, null);
      b.recordClockOffset(3, seenAt);

      if (order === 'site-primero') {
        await repository.saveSite(a);
        await repository.saveContact(b);
      } else {
        await repository.saveContact(b);
        await repository.saveSite(a);
      }

      const saved = store.devices.get(DEVICE_ID);
      expect(saved?.siteId).toBe('00000000-0000-4000-8000-0000000000a1');
      expect(saved?.timeZone).toBe('America/Mexico_City');
      expect(saved?.lastSeenAt).toEqual(seenAt);
      expect(saved?.clockOffsetSeconds).toBe(3);
    }
  });

  it('saveContact y saveSite rechazan sobre un equipo que no existe', async () => {
    const store = new InMemoryAttendanceStore();
    const repository = new InMemoryDeviceRepository(store);
    const ghost = Device.restore(DEVICE_ID, BASE_PROPS);

    await expect(repository.saveContact(ghost)).rejects.toThrow();
    await expect(repository.saveSite(ghost)).rejects.toThrow();
  });
});
