import { describe, expect, it } from 'vitest';

import { Device, type DeviceId } from '@/modules/attendance/domain/device';
import { Punch, type PunchId } from '@/modules/attendance/domain/punch';
import { PrismaAttendanceQueries } from '@/modules/attendance/infrastructure/prisma-attendance.queries';
import { PrismaDeviceRepository } from '@/modules/attendance/infrastructure/prisma-device.repository';
import { PrismaPunchRepository } from '@/modules/attendance/infrastructure/prisma-punch.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

// CASCADE en el TRUNCATE de support.ts limpia punches al vaciar devices; se listan ambas por claridad.
const database = useTestDatabase(['attendance.punches', 'attendance.devices']);
const devices = new PrismaDeviceRepository({ database });
const punches = new PrismaPunchRepository({ database });
const queries = new PrismaAttendanceQueries({ database });
const ids = new SequentialIdGenerator();

const NOW = new Date('2026-09-29T00:00:00Z');

async function savedDevice(serialNumber: string, name = `Equipo ${serialNumber}`): Promise<Device> {
  const created = Device.register({
    id: ids.next() as DeviceId,
    serialNumber,
    name,
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: NOW,
  });
  if (!created.ok) throw created.error;
  const saved = await devices.save(created.value);
  if (!saved.ok) throw saved.error;
  return created.value;
}

function punch(device: Device, pin: string, deviceTime: string, verifyMode = '1'): Punch {
  const created = Punch.fromDevice({
    id: ids.next() as PunchId,
    deviceId: device.id,
    timeZone: device.timeZone,
    pin,
    deviceTime,
    status: '0',
    verifyMode,
    receivedAt: NOW,
  });
  if (!created.ok) throw created.error;
  return created.value;
}

describe('PrismaDeviceRepository', () => {
  it('guarda y rehidrata el equipo, por id y por serial', async () => {
    const device = await savedDevice('TESTSN001', 'Entrada');

    const byId = await devices.findById(device.id);
    const bySerial = await devices.findBySerialNumber('TESTSN001');

    expect(byId?.serialNumber).toBe('TESTSN001');
    expect(bySerial?.id).toBe(device.id);
    expect(bySerial?.name).toBe('Entrada');
    expect(bySerial?.timeZone).toBe('America/Cancun');
    expect(bySerial?.active).toBe(true);
    expect(bySerial?.registeredAt).toEqual(NOW);
    expect(bySerial?.lastSeenAt).toBeNull();
  });

  it('devuelve null si el equipo no existe', async () => {
    expect(await devices.findBySerialNumber('NOEXISTE')).toBeNull();
    expect(await devices.findById('00000000-0000-4000-8000-999999999999' as DeviceId)).toBeNull();
  });

  it('guardar de nuevo el mismo agregado actualiza lastSeenAt (upsert)', async () => {
    const device = await savedDevice('TESTSN001');
    const seenAt = new Date('2026-09-29T10:00:00Z');
    device.markSeen(seenAt);

    const result = await devices.save(device);

    expect(result.ok).toBe(true);
    expect((await devices.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(seenAt);
  });

  it('un segundo equipo con el mismo serial: el índice único se traduce al conflicto de dominio', async () => {
    await savedDevice('TESTSN001');
    const duplicate = Device.register({
      id: ids.next() as DeviceId,
      serialNumber: 'TESTSN001',
      name: 'Duplicado',
      siteId: '00000000-0000-4000-8000-0000000000a1',
      timeZone: 'UTC',
      now: NOW,
    });
    if (!duplicate.ok) throw duplicate.error;

    const result = await devices.save(duplicate.value);

    expect(!result.ok && result.error.code).toBe('DEVICE_ALREADY_REGISTERED');
  });
});

describe('PrismaPunchRepository.saveNew', () => {
  it('lista vacía: no inserta nada', async () => {
    expect(await punches.saveNew([])).toEqual({ inserted: 0 });
  });

  it('guarda la hora local y el instante UTC', async () => {
    const device = await savedDevice('TESTSN001');

    const result = await punches.saveNew([punch(device, '2', '2026-09-28 12:17:29')]);

    expect(result).toEqual({ inserted: 1 });
    const rows = await database.client.attendancePunch.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.deviceLocalTime).toBe('2026-09-28 12:17:29');
    expect(rows[0]?.occurredAt.toISOString()).toBe('2026-09-28T17:17:29.000Z');
  });

  it('descarta en silencio lo ya guardado (device, pin, hora local) y cuenta solo lo nuevo', async () => {
    const device = await savedDevice('TESTSN001');
    await punches.saveNew([punch(device, '1', '2026-09-28 08:00:00')]);

    const result = await punches.saveNew([
      punch(device, '1', '2026-09-28 08:00:00'),
      punch(device, '1', '2026-09-28 08:00:01'),
      punch(device, '2', '2026-09-28 08:00:00'),
    ]);

    expect(result).toEqual({ inserted: 2 });
    expect(await database.client.attendancePunch.count()).toBe(3);
  });

  it('el mismo PIN y hora en otro equipo no es duplicado', async () => {
    const a = await savedDevice('SNA');
    const b = await savedDevice('SNB');

    const result = await punches.saveNew([
      punch(a, '1', '2026-09-28 08:00:00'),
      punch(b, '1', '2026-09-28 08:00:00'),
    ]);

    expect(result).toEqual({ inserted: 2 });
  });
});

describe('PrismaAttendanceQueries', () => {
  it('listDevices ordena por nombre, pagina y calcula lastPunchAt por equipo', async () => {
    const beta = await savedDevice('SNB', 'Beta');
    await savedDevice('SNA', 'Alfa');
    await savedDevice('SNC', 'Gamma');
    await punches.saveNew([
      punch(beta, '1', '2026-09-28 08:00:00'),
      punch(beta, '1', '2026-09-28 09:00:00'),
    ]);

    const first = await queries.listDevices({ page: 1, pageSize: 2 });
    const second = await queries.listDevices({ page: 2, pageSize: 2 });

    expect(first.total).toBe(3);
    expect(first.items.map((item) => item.name)).toEqual(['Alfa', 'Beta']);
    expect(first.items[0]?.lastPunchAt).toBeNull();
    expect(first.items[1]?.lastPunchAt).toBe('2026-09-28T14:00:00.000Z');
    expect(first.items[1]?.registeredAt).toBe(NOW.toISOString());
    expect(first.items[1]?.lastSeenAt).toBeNull();
    expect(second.items.map((item) => item.name)).toEqual(['Gamma']);
  });

  it('listDevices expone lastSeenAt cuando el equipo se vio', async () => {
    const device = await savedDevice('TESTSN001');
    const seenAt = new Date('2026-09-29T10:00:00Z');
    device.markSeen(seenAt);
    await devices.save(device);

    const page = await queries.listDevices({ page: 1, pageSize: 20 });

    expect(page.items[0]?.lastSeenAt).toBe(seenAt.toISOString());
  });

  describe('listPunches', () => {
    async function seed() {
      const a = await savedDevice('SNA');
      const b = await savedDevice('SNB');
      await punches.saveNew([
        punch(a, '1', '2026-09-28 08:00:00'),
        punch(a, '2', '2026-09-28 09:00:00'),
        punch(b, '1', '2026-09-28 10:00:00'),
      ]);
      return { a, b };
    }

    it('ordena por instante descendente e incluye el serial del equipo', async () => {
      await seed();

      const page = await queries.listPunches({ page: 1, pageSize: 20 });

      expect(page.total).toBe(3);
      expect(page.items.map((item) => item.deviceLocalTime)).toEqual([
        '2026-09-28 10:00:00',
        '2026-09-28 09:00:00',
        '2026-09-28 08:00:00',
      ]);
      expect(page.items[0]).toMatchObject({
        serialNumber: 'SNB',
        pin: '1',
        occurredAt: '2026-09-28T15:00:00.000Z',
        receivedAt: NOW.toISOString(),
      });
    });

    it('desempata por id cuando el instante coincide', async () => {
      const { a, b } = await seed();
      await punches.saveNew([
        punch(a, '7', '2026-09-28 10:00:00'),
        punch(b, '7', '2026-09-28 10:00:00'),
      ]);

      const page = await queries.listPunches({ page: 1, pageSize: 20 });
      const sameInstant = page.items.filter(
        (item) => item.deviceLocalTime === '2026-09-28 10:00:00',
      );

      expect(sameInstant).toHaveLength(3);
      const sortedIds = [...sameInstant.map((item) => item.id)].sort().reverse();
      expect(sameInstant.map((item) => item.id)).toEqual(sortedIds);
    });

    it('filtra por equipo y por PIN', async () => {
      const { a } = await seed();

      const byDevice = await queries.listPunches({ page: 1, pageSize: 20, deviceId: a.id });
      const byPin = await queries.listPunches({ page: 1, pageSize: 20, pin: '1' });

      expect(byDevice.total).toBe(2);
      expect(byDevice.items.every((item) => item.serialNumber === 'SNA')).toBe(true);
      expect(byPin.total).toBe(2);
    });

    it('filtra por rango con extremos incluidos y admite solo uno de los límites', async () => {
      await seed();
      const exact = '2026-09-28T14:00:00.000Z';

      const both = await queries.listPunches({ page: 1, pageSize: 20, from: exact, to: exact });
      const onlyFrom = await queries.listPunches({ page: 1, pageSize: 20, from: exact });
      const onlyTo = await queries.listPunches({ page: 1, pageSize: 20, to: exact });

      expect(both.items.map((item) => item.deviceLocalTime)).toEqual(['2026-09-28 09:00:00']);
      expect(onlyFrom.total).toBe(2);
      expect(onlyTo.total).toBe(2);
    });

    it('pins restringe a esos PIN (IN) y mantiene el orden y el total', async () => {
      await seed();

      const page = await queries.listPunches({ page: 1, pageSize: 20, pins: ['2', 'inexistente'] });
      const both = await queries.listPunches({ page: 1, pageSize: 20, pins: ['1', '2'] });

      expect(page.total).toBe(1);
      expect(page.items.map((item) => item.pin)).toEqual(['2']);
      expect(both.items.map((item) => item.deviceLocalTime)).toEqual([
        '2026-09-28 10:00:00',
        '2026-09-28 09:00:00',
        '2026-09-28 08:00:00',
      ]);
    });

    it('pins vacío no devuelve filas', async () => {
      await seed();

      const page = await queries.listPunches({ page: 1, pageSize: 20, pins: [] });

      expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });

    it('pins y pin se combinan con AND', async () => {
      await seed();

      const inside = await queries.listPunches({
        page: 1,
        pageSize: 20,
        pin: '1',
        pins: ['1', '2'],
      });
      const outside = await queries.listPunches({ page: 1, pageSize: 20, pin: '1', pins: ['2'] });

      expect(inside.total).toBe(2);
      expect(outside.total).toBe(0);
    });

    it('pins se combina con equipo y rango', async () => {
      const { a } = await seed();

      const page = await queries.listPunches({
        page: 1,
        pageSize: 20,
        pins: ['1', '2'],
        deviceId: a.id,
        from: '2026-09-28T14:00:00.000Z',
      });

      expect(page.items.map((item) => item.deviceLocalTime)).toEqual(['2026-09-28 09:00:00']);
    });

    it('pagina sobre el total filtrado', async () => {
      await seed();

      const second = await queries.listPunches({ page: 2, pageSize: 2 });

      expect(second.total).toBe(3);
      expect(second.items.map((item) => item.deviceLocalTime)).toEqual(['2026-09-28 08:00:00']);
    });
  });
});
