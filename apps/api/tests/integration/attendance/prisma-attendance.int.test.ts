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

  it('persiste y rehidrata la sede y la medición de desfase (plan attendance-marcaciones/003)', async () => {
    const device = await savedDevice('TESTSN001');
    expect((await devices.findBySerialNumber('TESTSN001'))?.siteId).toBe(
      '00000000-0000-4000-8000-0000000000a1',
    );
    const measuredAt = new Date('2026-09-29T10:00:00Z');
    device.recordClockOffset(-3600, measuredAt);
    await devices.save(device);

    const rehydrated = await devices.findById(device.id);

    expect(rehydrated?.clockOffsetSeconds).toBe(-3600);
    expect(rehydrated?.clockOffsetMeasuredAt).toEqual(measuredAt);
    expect(rehydrated?.clockSuspect).toBe(true);
  });

  it('assignSite guardado cambia siteId y timeZone en la fila', async () => {
    const device = await savedDevice('TESTSN001');
    device.assignSite('00000000-0000-4000-8000-0000000000b2', 'America/Mexico_City');

    await devices.save(device);

    const rehydrated = await devices.findById(device.id);
    expect(rehydrated?.siteId).toBe('00000000-0000-4000-8000-0000000000b2');
    expect(rehydrated?.timeZone).toBe('America/Mexico_City');
  });

  it('un equipo sin sede ni medición (filas anteriores) se rehidrata con null', async () => {
    const id = ids.next() as DeviceId;
    await database.client.attendanceDevice.create({
      data: {
        id,
        serialNumber: 'LEGACYSN1',
        name: 'Anterior',
        timeZone: 'UTC',
        active: true,
        registeredAt: NOW,
      },
    });

    const rehydrated = await devices.findById(id);

    expect(rehydrated?.siteId).toBeNull();
    expect(rehydrated?.clockOffsetSeconds).toBeNull();
    expect(rehydrated?.clockOffsetMeasuredAt).toBeNull();
    expect(rehydrated?.clockSuspect).toBe(false);
  });

  describe('escritura dirigida (plan attendance-marcaciones/005)', () => {
    // Reparación de revisión (hallazgo L1, plan 005): el snapshot "viejo" se carga ANTES de que
    // el otro escritor guarde, para que de verdad desconozca sus columnas (si se cargara después,
    // un `update` de la fila entera pasaría el test igual).
    it('saveActivity escribe lastSeenAt y el desfase, pero no toca siteId ni timeZone', async () => {
      const device = await savedDevice('TESTSN001');
      // Snapshot cargado antes de que el admin asigne la sede: desconoce siteId/timeZone nuevos.
      const stalePush = await devices.findById(device.id);
      if (!stalePush) throw new Error('equipo no encontrado');
      device.assignSite('00000000-0000-4000-8000-0000000000b2', 'America/Mexico_City');
      await devices.saveSite(device);
      const seenAt = new Date('2026-09-29T10:00:00Z');
      stalePush.markSeen(seenAt);
      stalePush.recordClockOffset(5, seenAt);

      await devices.saveActivity(stalePush);

      const rehydrated = await devices.findById(device.id);
      expect(rehydrated?.lastSeenAt).toEqual(seenAt);
      expect(rehydrated?.clockOffsetSeconds).toBe(5);
      expect(rehydrated?.siteId).toBe('00000000-0000-4000-8000-0000000000b2');
      expect(rehydrated?.timeZone).toBe('America/Mexico_City');
    });

    it('saveSite escribe siteId y timeZone, pero no toca lastSeenAt ni el desfase', async () => {
      const device = await savedDevice('TESTSN001');
      // Snapshot cargado antes de que el tráfico anote actividad: desconoce lastSeenAt/desfase nuevos.
      const staleAdmin = await devices.findById(device.id);
      if (!staleAdmin) throw new Error('equipo no encontrado');
      const seenAt = new Date('2026-09-29T10:00:00Z');
      device.markSeen(seenAt);
      device.recordClockOffset(5, seenAt);
      await devices.saveActivity(device);
      staleAdmin.assignSite('00000000-0000-4000-8000-0000000000b2', 'America/Mexico_City');

      await devices.saveSite(staleAdmin);

      const rehydrated = await devices.findById(device.id);
      expect(rehydrated?.siteId).toBe('00000000-0000-4000-8000-0000000000b2');
      expect(rehydrated?.timeZone).toBe('America/Mexico_City');
      expect(rehydrated?.lastSeenAt).toEqual(seenAt);
      expect(rehydrated?.clockOffsetSeconds).toBe(5);
    });

    it.each(['sede-primero', 'actividad-primero'] as const)(
      // Criterio de aceptación 1: la fila final tiene la sede nueva y la actividad de B, en
      // cualquier orden de escritura.
      'la carrera entre asignar sede y tráfico del equipo (%s) no pierde ningún cambio',
      async (order) => {
        const device = await savedDevice('TESTSN001');
        // Dos instancias cargadas de la misma fila, antes de que ninguna de las dos escriba.
        const a = await devices.findById(device.id);
        const b = await devices.findById(device.id);
        if (!a || !b) throw new Error('equipo no encontrado');
        a.assignSite('00000000-0000-4000-8000-0000000000b2', 'America/Mexico_City');
        const seenAt = new Date('2026-09-29T10:00:00Z');
        b.markSeen(seenAt);
        b.recordClockOffset(3, seenAt);

        if (order === 'sede-primero') {
          await devices.saveSite(a);
          await devices.saveActivity(b);
        } else {
          await devices.saveActivity(b);
          await devices.saveSite(a);
        }

        const rehydrated = await devices.findById(device.id);
        expect(rehydrated?.siteId).toBe('00000000-0000-4000-8000-0000000000b2');
        expect(rehydrated?.timeZone).toBe('America/Mexico_City');
        expect(rehydrated?.lastSeenAt).toEqual(seenAt);
        expect(rehydrated?.clockOffsetSeconds).toBe(3);
      },
    );

    it('saveActivity y saveSite rechazan sobre un equipo que no existe', async () => {
      const ghost = Device.restore('00000000-0000-4000-8000-00000000dead' as DeviceId, {
        serialNumber: 'FANTASMA',
        name: 'No existe',
        timeZone: 'UTC',
        active: true,
        registeredAt: NOW,
        lastSeenAt: null,
        siteId: null,
        clockOffsetSeconds: null,
        clockOffsetMeasuredAt: null,
      });

      await expect(devices.saveActivity(ghost)).rejects.toThrow();
      await expect(devices.saveSite(ghost)).rejects.toThrow();
    });
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

  it('listDevices devuelve sede, desfase y clockSuspect con el umbral de 300 s', async () => {
    const measuredAt = new Date('2026-09-29T10:00:00Z');
    const edge = await savedDevice('SNA', 'A borde');
    edge.recordClockOffset(300, measuredAt);
    await devices.save(edge);
    const over = await savedDevice('SNB', 'B excedido');
    over.recordClockOffset(-301, measuredAt);
    await devices.save(over);
    await savedDevice('SNC', 'C sin medir');

    const page = await queries.listDevices({ page: 1, pageSize: 20 });

    expect(page.items.map((item) => item.siteId)).toEqual(
      Array(3).fill('00000000-0000-4000-8000-0000000000a1'),
    );
    expect(page.items[0]).toMatchObject({
      clockOffsetSeconds: 300,
      clockOffsetMeasuredAt: measuredAt.toISOString(),
      clockSuspect: false,
    });
    expect(page.items[1]).toMatchObject({ clockOffsetSeconds: -301, clockSuspect: true });
    expect(page.items[2]).toMatchObject({
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
      clockSuspect: false,
    });
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
