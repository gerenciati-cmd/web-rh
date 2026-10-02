import { beforeEach, describe, expect, it } from 'vitest';

import type { Actor, Grant } from '@/shared/application/actor';

import { Device, type DeviceId } from '../../domain/device';
import { Punch, type PunchId } from '../../domain/punch';
import {
  InMemoryAttendanceQueries,
  InMemoryAttendanceStore,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { ListDevices } from './list-devices.query';
import { ListPunches } from './list-punches.query';

const READ = 'attendance.punches:read' as const;
const DEVICE_A = '00000000-0000-4000-8000-0000000000a1' as DeviceId;
const DEVICE_B = '00000000-0000-4000-8000-0000000000b2' as DeviceId;

function actorWith(...grants: Grant[]): Actor {
  return { userId: 'user-1', sessionId: 'session-1', grants };
}

function device(id: DeviceId, serialNumber: string, name: string): Device {
  const created = Device.register({
    id,
    serialNumber,
    name,
    timeZone: 'America/Cancun',
    now: new Date('2026-09-01T00:00:00Z'),
  });
  if (!created.ok) throw created.error;
  return created.value;
}

let counter = 0;
function punch(deviceId: DeviceId, pin: string, deviceTime: string): Punch {
  counter += 1;
  const created = Punch.fromDevice({
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}` as PunchId,
    deviceId,
    timeZone: 'America/Cancun',
    pin,
    deviceTime,
    status: '0',
    verifyMode: '1',
    receivedAt: new Date('2026-09-29T00:00:00Z'),
  });
  if (!created.ok) throw created.error;
  return created.value;
}

describe('ListPunches', () => {
  let store: InMemoryAttendanceStore;
  let listPunches: ListPunches;

  beforeEach(() => {
    store = new InMemoryAttendanceStore();
    store.devices.set(DEVICE_A, device(DEVICE_A, 'SNA', 'Beta'));
    store.devices.set(DEVICE_B, device(DEVICE_B, 'SNB', 'Alfa'));
    for (const p of [
      punch(DEVICE_A, '1', '2026-09-28 08:00:00'),
      punch(DEVICE_A, '2', '2026-09-28 09:00:00'),
      punch(DEVICE_B, '1', '2026-09-28 10:00:00'),
    ]) {
      store.punches.set(p.id, p);
    }
    listPunches = new ListPunches({ attendanceQueries: new InMemoryAttendanceQueries(store) });
  });

  it('concesión de todo el holding: ve las marcaciones, la más reciente primero', async () => {
    const page = await listPunches.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: null }),
    });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => item.deviceLocalTime)).toEqual([
      '2026-09-28 10:00:00',
      '2026-09-28 09:00:00',
      '2026-09-28 08:00:00',
    ]);
    expect(page.items[0]).toMatchObject({
      serialNumber: 'SNB',
      occurredAt: '2026-09-28T15:00:00.000Z',
    });
  });

  it('un permiso atado a una empresa devuelve una página vacía con la paginación pedida', async () => {
    const page = await listPunches.execute({
      page: 2,
      pageSize: 5,
      actor: actorWith({ permission: READ, companyId: 'company-a' }),
    });

    expect(page).toEqual({ items: [], total: 0, page: 2, pageSize: 5 });
  });

  it('sin el permiso de marcaciones (otro permiso no cuenta) devuelve vacío', async () => {
    const page = await listPunches.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: 'attendance.devices:read', companyId: null }),
    });

    expect(page.total).toBe(0);
    expect(page.items).toEqual([]);
  });

  it('filtra por equipo, por PIN y por rango de instantes UTC (extremos incluidos)', async () => {
    const actor = actorWith({ permission: READ, companyId: null });
    const base = { page: 1, pageSize: 20, actor };

    const byDevice = await listPunches.execute({ ...base, deviceId: DEVICE_A });
    const byPin = await listPunches.execute({ ...base, pin: '1' });
    const byRange = await listPunches.execute({
      ...base,
      from: '2026-09-28T14:00:00.000Z',
      to: '2026-09-28T14:00:00.000Z',
    });

    expect(byDevice.items.map((item) => item.pin)).toEqual(['2', '1']);
    expect(byPin.total).toBe(2);
    expect(byRange.items.map((item) => item.deviceLocalTime)).toEqual(['2026-09-28 09:00:00']);
  });

  it('pagina sobre el total filtrado', async () => {
    const actor = actorWith({ permission: READ, companyId: null });

    const second = await listPunches.execute({ page: 2, pageSize: 2, actor });

    expect(second.total).toBe(3);
    expect(second.items.map((item) => item.deviceLocalTime)).toEqual(['2026-09-28 08:00:00']);
  });
});

describe('ListDevices', () => {
  it('lista por nombre y calcula lastPunchAt con la marcación más reciente', async () => {
    const store = new InMemoryAttendanceStore();
    store.devices.set(DEVICE_A, device(DEVICE_A, 'SNA', 'Beta'));
    store.devices.set(DEVICE_B, device(DEVICE_B, 'SNB', 'Alfa'));
    for (const p of [
      punch(DEVICE_A, '1', '2026-09-28 08:00:00'),
      punch(DEVICE_A, '2', '2026-09-28 09:00:00'),
    ]) {
      store.punches.set(p.id, p);
    }
    const listDevices = new ListDevices({
      attendanceQueries: new InMemoryAttendanceQueries(store),
    });

    const page = await listDevices.execute({ page: 1, pageSize: 20 });

    expect(page.items.map((item) => item.name)).toEqual(['Alfa', 'Beta']);
    expect(page.items[0]?.lastPunchAt).toBeNull();
    expect(page.items[1]?.lastPunchAt).toBe('2026-09-28T14:00:00.000Z');
    expect(page.items[1]?.lastSeenAt).toBeNull();
  });
});
