import { describe, expect, it, vi } from 'vitest';

import { Device, type DeviceId } from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { AssignDeviceSite } from './assign-device-site.command';

const SITE_ID = '00000000-0000-4000-8000-0000000000b1';
const INACTIVE_SITE_ID = '00000000-0000-4000-8000-0000000000b2';
const DEVICE_ID = '00000000-0000-4000-8000-0000000000d1' as DeviceId;

async function setUp() {
  const deviceRepository = new InMemoryDeviceRepository(new InMemoryAttendanceStore());
  // Equipo registrado antes del plan: sin sede y con una zona libre.
  await deviceRepository.save(
    Device.restore(DEVICE_ID, {
      serialNumber: 'TESTSN001',
      name: 'Entrada',
      timeZone: 'UTC',
      active: true,
      registeredAt: new Date('2026-01-15T12:00:00Z'),
      lastSeenAt: null,
      siteId: null,
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
    }),
  );
  const command = new AssignDeviceSite({
    deviceRepository,
    deviceSiteDirectory: {
      find: (id: string) =>
        Promise.resolve(
          id === SITE_ID
            ? { id, timeZone: 'America/Mexico_City', active: true }
            : id === INACTIVE_SITE_ID
              ? { id, timeZone: 'America/Cancun', active: false }
              : null,
        ),
    },
  });
  return { command, deviceRepository };
}

describe('AssignDeviceSite', () => {
  it('asigna la sede y copia su zona horaria al equipo', async () => {
    const { command, deviceRepository } = await setUp();

    const result = await command.execute({ deviceId: DEVICE_ID, siteId: SITE_ID });

    expect(result.ok).toBe(true);
    const saved = await deviceRepository.findById(DEVICE_ID);
    expect(saved?.siteId).toBe(SITE_ID);
    expect(saved?.timeZone).toBe('America/Mexico_City');
  });

  // Reparación de revisión (hallazgo M1, plan 005): el repositorio en memoria devuelve la misma
  // referencia guardada, así que un `save(device)` completo deja el mismo estado final que
  // `saveSite(device)` y el test de arriba (que solo mira el estado) no lo distingue. Se espía el
  // método llamado.
  it('guarda la sede con saveSite y nunca con save (hallazgo M1 de la revisión)', async () => {
    const { command, deviceRepository } = await setUp();
    const saveSiteSpy = vi.spyOn(deviceRepository, 'saveSite');
    const saveSpy = vi.spyOn(deviceRepository, 'save');

    await command.execute({ deviceId: DEVICE_ID, siteId: SITE_ID });

    expect(saveSiteSpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('un equipo inexistente da DEVICE_NOT_FOUND', async () => {
    const { command } = await setUp();

    const result = await command.execute({
      deviceId: '00000000-0000-4000-8000-0000000000ff',
      siteId: SITE_ID,
    });

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_FOUND');
  });

  it('una sede inexistente da SITE_NOT_FOUND y no cambia el equipo', async () => {
    const { command, deviceRepository } = await setUp();

    const result = await command.execute({
      deviceId: DEVICE_ID,
      siteId: '00000000-0000-4000-8000-0000000000ff',
    });

    expect(!result.ok && result.error.code).toBe('SITE_NOT_FOUND');
    const saved = await deviceRepository.findById(DEVICE_ID);
    expect(saved?.siteId).toBeNull();
    expect(saved?.timeZone).toBe('UTC');
  });

  it('una sede inactiva da SITE_INACTIVE y no cambia el equipo', async () => {
    const { command, deviceRepository } = await setUp();

    const result = await command.execute({ deviceId: DEVICE_ID, siteId: INACTIVE_SITE_ID });

    expect(!result.ok && result.error.code).toBe('SITE_INACTIVE');
    const saved = await deviceRepository.findById(DEVICE_ID);
    expect(saved?.siteId).toBeNull();
    expect(saved?.timeZone).toBe('UTC');
  });
});
