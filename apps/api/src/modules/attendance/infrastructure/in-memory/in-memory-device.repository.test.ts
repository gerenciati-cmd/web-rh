import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '../../domain/device';

import { InMemoryAttendanceStore, InMemoryDeviceRepository } from './in-memory-attendance.store';

const NOW = new Date('2026-10-05T17:00:00Z');
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000a2';

function newDevice(n: number, serialNumber = `SN00${n}`): Device {
  const result = Device.register({
    id: `00000000-0000-4000-8000-00000000000${n}` as DeviceId,
    serialNumber,
    name: `Equipo ${n}`,
    siteId: SITE_A,
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!result.ok) throw result.error;
  return result.value;
}

async function load(repository: InMemoryDeviceRepository, id: DeviceId): Promise<Device> {
  const device = await repository.findById(id);
  if (!device) throw new Error('el equipo debería existir');
  return device;
}

async function setUp() {
  const repository = new InMemoryDeviceRepository(new InMemoryAttendanceStore());
  const device = newDevice(1);
  await repository.add(device);
  return { repository, device };
}

// El adaptador en memoria debe comportarse como Prisma: cada save* escribe solo sus columnas y
// los agregados cargados son copias independientes (si no, los tests de carrera no probarían nada).
describe('InMemoryDeviceRepository: escrituras dirigidas', () => {
  it('add: un id o un serial repetidos devuelven DEVICE_ALREADY_REGISTERED', async () => {
    const { repository, device } = await setUp();

    const sameSerial = await repository.add(newDevice(2, device.serialNumber));
    const sameId = await repository.add(newDevice(1, 'OTROSERIAL'));

    expect(!sameSerial.ok && sameSerial.error.code).toBe('DEVICE_ALREADY_REGISTERED');
    expect(!sameId.ok && sameId.error.code).toBe('DEVICE_ALREADY_REGISTERED');
  });

  it('saveContact solo escribe contacto, IP y desfase: no pisa sede ni redes de otro', async () => {
    const { repository, device } = await setUp();
    const stale = await load(repository, device.id);
    const admin = await load(repository, device.id);
    admin.assignSite(SITE_B, 'America/Mexico_City', new Date('2026-10-08T12:00:00Z'));
    admin.setAllowedNetworks(['10.0.0.0/8'], new Date('2026-10-08T12:00:00Z'));
    await repository.saveSite(admin);
    await repository.saveAllowedNetworks(admin);

    stale.markSeen(NOW, '10.0.0.5');
    stale.recordClockOffset(-42, NOW);
    await repository.saveContact(stale);

    const stored = await load(repository, device.id);
    expect(stored.lastSeenAt).toEqual(NOW);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.clockOffsetSeconds).toBe(-42);
    expect(stored.clockOffsetMeasuredAt).toEqual(NOW);
    expect(stored.siteId).toBe(SITE_B);
    expect(stored.timeZone).toBe('America/Mexico_City');
    expect(stored.allowedNetworks).toEqual(['10.0.0.0/8']);
  });

  it('saveSite solo escribe sede y zona: no pisa contacto ni redes de otro', async () => {
    const { repository, device } = await setUp();
    const stale = await load(repository, device.id);
    const other = await load(repository, device.id);
    other.markSeen(NOW, '10.0.0.5');
    other.setAllowedNetworks(['10.0.0.0/8'], new Date('2026-10-08T12:00:00Z'));
    await repository.saveContact(other);
    await repository.saveAllowedNetworks(other);

    stale.assignSite(SITE_B, 'America/Mexico_City', new Date('2026-10-08T12:00:00Z'));
    await repository.saveSite(stale);

    const stored = await load(repository, device.id);
    expect(stored.siteId).toBe(SITE_B);
    expect(stored.timeZone).toBe('America/Mexico_City');
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.allowedNetworks).toEqual(['10.0.0.0/8']);
  });

  it('saveAllowedNetworks solo escribe las redes: no pisa contacto ni sede de otro', async () => {
    const { repository, device } = await setUp();
    const stale = await load(repository, device.id);
    const other = await load(repository, device.id);
    other.markSeen(NOW, '10.0.0.5');
    other.assignSite(SITE_B, 'America/Mexico_City', new Date('2026-10-08T12:00:00Z'));
    await repository.saveContact(other);
    await repository.saveSite(other);

    stale.setAllowedNetworks(['192.168.0.0/16'], new Date('2026-10-08T12:00:00Z'));
    await repository.saveAllowedNetworks(stale);

    const stored = await load(repository, device.id);
    expect(stored.allowedNetworks).toEqual(['192.168.0.0/16']);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.siteId).toBe(SITE_B);
  });

  it('los agregados cargados son copias: mutar uno sin guardar no cambia lo almacenado', async () => {
    const { repository, device } = await setUp();
    const loaded = await load(repository, device.id);

    loaded.setAllowedNetworks(['10.0.0.0/8'], new Date('2026-10-08T12:00:00Z'));

    expect((await load(repository, device.id)).allowedNetworks).toEqual([]);
  });

  it('un save* sobre un equipo inexistente rechaza la promesa, como el update de Prisma', async () => {
    const { repository } = await setUp();
    const ghost = newDevice(9);

    await expect(repository.saveContact(ghost)).rejects.toThrow();
    await expect(repository.saveSite(ghost)).rejects.toThrow();
    await expect(repository.saveAllowedNetworks(ghost)).rejects.toThrow();
  });
});
