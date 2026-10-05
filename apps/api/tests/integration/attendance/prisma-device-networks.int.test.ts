import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '@/modules/attendance/domain/device';
import { PrismaAttendanceQueries } from '@/modules/attendance/infrastructure/prisma-attendance.queries';
import { PrismaDeviceRepository } from '@/modules/attendance/infrastructure/prisma-device.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

/**
 * Plan attendance-marcaciones/005: columnas de la migración `add_device_networks` y escrituras
 * dirigidas del repositorio (cada `save*` toca solo sus columnas).
 */
const database = useTestDatabase(['attendance.punches', 'attendance.devices']);
const devices = new PrismaDeviceRepository({ database });
const queries = new PrismaAttendanceQueries({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-10-05T17:00:00Z');
const SITE_A = '00000000-0000-4000-8000-0000000000a1';
const SITE_B = '00000000-0000-4000-8000-0000000000a2';

async function savedDevice(serialNumber = 'TESTSN001'): Promise<Device> {
  const created = Device.register({
    id: ids.next() as DeviceId,
    serialNumber,
    name: `Equipo ${serialNumber}`,
    siteId: SITE_A,
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await devices.add(created.value);
  if (!saved.ok) throw saved.error;
  return created.value;
}

async function reload(id: DeviceId): Promise<Device> {
  const device = await devices.findById(id);
  if (!device) throw new Error('el equipo debería existir');
  return device;
}

describe('migración add_device_networks', () => {
  it('agrega allowed_networks (TEXT[]) y last_seen_ip (VARCHAR(45)) a attendance.devices', async () => {
    const columns = await database.client.$queryRaw<
      { column_name: string; data_type: string; character_maximum_length: number | null }[]
    >`SELECT column_name, data_type, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = 'attendance' AND table_name = 'devices'
        AND column_name IN ('allowed_networks', 'last_seen_ip')
      ORDER BY column_name`;

    expect(columns).toEqual([
      { column_name: 'allowed_networks', data_type: 'ARRAY', character_maximum_length: null },
      { column_name: 'last_seen_ip', data_type: 'character varying', character_maximum_length: 45 },
    ]);
  });

  it('una fila insertada sin esas columnas (como las anteriores a la migración) queda sin restricción y sin IP', async () => {
    const id = ids.next() as DeviceId;
    await database.client.$executeRaw`
      INSERT INTO attendance.devices (id, serial_number, name, time_zone, active, registered_at)
      VALUES (${id}::uuid, 'LEGACYSN1', 'Anterior', 'UTC', true, ${NOW})`;

    const device = await reload(id);

    expect(device.allowedNetworks).toEqual([]);
    expect(device.receivesCommands).toBe(false);
    expect(device.lastSeenIp).toBeNull();
    expect(device.acceptsAddress('203.0.113.7')).toBe(true);
  });

  it('add persiste las redes y la IP con los que nace el equipo (vacías y null)', async () => {
    const device = await savedDevice();

    const stored = await reload(device.id);

    expect(stored.allowedNetworks).toEqual([]);
    expect(stored.lastSeenIp).toBeNull();
  });
});

describe('PrismaDeviceRepository: escrituras dirigidas', () => {
  it('saveAllowedNetworks guarda las redes canónicas y listDevices las expone', async () => {
    const device = await savedDevice();
    device.setAllowedNetworks(['127.0.0.1', '10.1.2.3/24']);

    await devices.saveAllowedNetworks(device);

    expect((await reload(device.id)).allowedNetworks).toEqual(['127.0.0.1/32', '10.1.2.0/24']);
    const page = await queries.listDevices({ page: 1, pageSize: 10 });
    expect(page.items[0]?.allowedNetworks).toEqual(['127.0.0.1/32', '10.1.2.0/24']);
  });

  it('saveAllowedNetworks con lista vacía quita la restricción', async () => {
    const device = await savedDevice();
    device.setAllowedNetworks(['10.0.0.0/8']);
    await devices.saveAllowedNetworks(device);
    device.setAllowedNetworks([]);

    await devices.saveAllowedNetworks(device);

    expect((await reload(device.id)).allowedNetworks).toEqual([]);
  });

  it('saveContact guarda lastSeenAt, lastSeenIp y el desfase, y listDevices expone la IP', async () => {
    const device = await savedDevice();
    device.markSeen(NOW, '10.0.0.5');
    device.recordClockOffset(-42, NOW);

    await devices.saveContact(device);

    const stored = await reload(device.id);
    expect(stored.lastSeenAt).toEqual(NOW);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.clockOffsetSeconds).toBe(-42);
    expect(stored.clockOffsetMeasuredAt).toEqual(NOW);
    const page = await queries.listDevices({ page: 1, pageSize: 10 });
    expect(page.items[0]?.lastSeenIp).toBe('10.0.0.5');
  });

  // Hallazgo attendance-escritura-completa-del-equipo: un envío carga el equipo, el admin cambia
  // la sede, y el envío guarda su contacto con la instancia vieja.
  it('carrera de la sede: saveContact de una instancia vieja no deshace el cambio de sede', async () => {
    const device = await savedDevice();
    const stale = await reload(device.id);
    const admin = await reload(device.id);
    admin.assignSite(SITE_B, 'America/Mexico_City');
    await devices.saveSite(admin);

    stale.markSeen(NOW, '10.0.0.5');
    stale.recordClockOffset(7, NOW);
    await devices.saveContact(stale);

    const stored = await reload(device.id);
    expect(stored.siteId).toBe(SITE_B);
    expect(stored.timeZone).toBe('America/Mexico_City');
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.clockOffsetSeconds).toBe(7);
  });

  it('carrera de las redes: saveContact de una instancia vieja no deshace las redes', async () => {
    const device = await savedDevice();
    const stale = await reload(device.id);
    const admin = await reload(device.id);
    admin.setAllowedNetworks(['10.0.0.0/8']);
    await devices.saveAllowedNetworks(admin);

    stale.markSeen(NOW, '10.0.0.5');
    await devices.saveContact(stale);

    const stored = await reload(device.id);
    expect(stored.allowedNetworks).toEqual(['10.0.0.0/8']);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
  });

  it('saveSite de una instancia vieja no deshace el contacto ni las redes', async () => {
    const device = await savedDevice();
    const stale = await reload(device.id);
    const other = await reload(device.id);
    other.markSeen(NOW, '10.0.0.5');
    other.setAllowedNetworks(['10.0.0.0/8']);
    await devices.saveContact(other);
    await devices.saveAllowedNetworks(other);

    stale.assignSite(SITE_B, 'America/Mexico_City');
    await devices.saveSite(stale);

    const stored = await reload(device.id);
    expect(stored.siteId).toBe(SITE_B);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.allowedNetworks).toEqual(['10.0.0.0/8']);
  });

  it('saveAllowedNetworks de una instancia vieja no deshace el contacto ni la sede', async () => {
    const device = await savedDevice();
    const stale = await reload(device.id);
    const other = await reload(device.id);
    other.markSeen(NOW, '10.0.0.5');
    other.assignSite(SITE_B, 'America/Mexico_City');
    await devices.saveContact(other);
    await devices.saveSite(other);

    stale.setAllowedNetworks(['192.168.0.0/16']);
    await devices.saveAllowedNetworks(stale);

    const stored = await reload(device.id);
    expect(stored.allowedNetworks).toEqual(['192.168.0.0/16']);
    expect(stored.lastSeenIp).toBe('10.0.0.5');
    expect(stored.siteId).toBe(SITE_B);
    expect(stored.timeZone).toBe('America/Mexico_City');
  });

  it('un save* sobre un equipo inexistente rechaza la promesa (update de Prisma)', async () => {
    const ghost = Device.restore('00000000-0000-4000-8000-999999999999' as DeviceId, {
      serialNumber: 'GHOST',
      name: 'Fantasma',
      timeZone: 'UTC',
      active: true,
      registeredAt: NOW,
      lastSeenAt: null,
      siteId: null,
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
      allowedNetworks: [],
      lastSeenIp: null,
    });

    await expect(devices.saveContact(ghost)).rejects.toThrow();
    await expect(devices.saveSite(ghost)).rejects.toThrow();
    await expect(devices.saveAllowedNetworks(ghost)).rejects.toThrow();
  });
});
