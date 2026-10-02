import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Actor, Grant } from '@/shared/application/actor';

import { Device, type DeviceId } from '../../domain/device';
import { Punch, type PunchId } from '../../domain/punch';
import {
  InMemoryAttendanceQueries,
  InMemoryAttendanceStore,
} from '../../infrastructure/in-memory/in-memory-attendance.store';
import type { PunchOwner, PunchOwnerDirectory } from '../ports/punch-owner-directory';

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
    siteId: '00000000-0000-4000-8000-0000000000a1',
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
    listPunches = new ListPunches({
      attendanceQueries: new InMemoryAttendanceQueries(store),
      // Sin colaboradores: ningún PIN tiene dueño y ninguna empresa tiene PIN.
      punchOwnerDirectory: {
        ownersOf: () => Promise.resolve(new Map()),
        pinsOfCompanies: () => Promise.resolve([]),
      },
    });
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

describe('ListPunches: atribución por RFC', () => {
  const RFC_ANA = 'GOMA850101AB1';
  const RFC_LUIS = 'PEXL900215AB2';
  const OWNERS = new Map<string, PunchOwner>([
    [RFC_ANA, { employeeId: 'emp-ana', companyId: 'company-a', fullName: 'Ana Rojas' }],
    [RFC_LUIS, { employeeId: 'emp-luis', companyId: 'company-b', fullName: 'Luis Pérez' }],
  ]);

  let ownersOf: ReturnType<typeof vi.fn<PunchOwnerDirectory['ownersOf']>>;
  let pinsOfCompanies: ReturnType<typeof vi.fn<PunchOwnerDirectory['pinsOfCompanies']>>;
  let listPunches: ListPunches;

  beforeEach(() => {
    const store = new InMemoryAttendanceStore();
    store.devices.set(DEVICE_A, device(DEVICE_A, 'SNA', 'Beta'));
    for (const p of [
      punch(DEVICE_A, RFC_ANA, '2026-09-28 08:00:00'),
      punch(DEVICE_A, RFC_LUIS, '2026-09-28 09:00:00'),
      punch(DEVICE_A, '1', '2026-09-28 10:00:00'),
    ]) {
      store.punches.set(p.id, p);
    }
    ownersOf = vi.fn<PunchOwnerDirectory['ownersOf']>((pins) =>
      Promise.resolve(
        new Map([...OWNERS].filter(([rfc]) => pins.includes(rfc))) as ReadonlyMap<
          string,
          PunchOwner
        >,
      ),
    );
    pinsOfCompanies = vi.fn<PunchOwnerDirectory['pinsOfCompanies']>((companyIds) =>
      Promise.resolve(
        [...OWNERS].flatMap(([rfc, owner]) => (companyIds.includes(owner.companyId) ? [rfc] : [])),
      ),
    );
    listPunches = new ListPunches({
      attendanceQueries: new InMemoryAttendanceQueries(store),
      punchOwnerDirectory: { ownersOf, pinsOfCompanies },
    });
  });

  it('holding: ve todas las marcaciones, enriquece las que tienen dueño y deja null el resto', async () => {
    const page = await listPunches.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: null }),
    });

    expect(page.total).toBe(3);
    expect(page.items.map((item) => [item.pin, item.employee])).toEqual([
      ['1', null],
      [RFC_LUIS, { id: 'emp-luis', fullName: 'Luis Pérez', companyId: 'company-b' }],
      [RFC_ANA, { id: 'emp-ana', fullName: 'Ana Rojas', companyId: 'company-a' }],
    ]);
    // El holding no necesita acotar por PIN de empresa.
    expect(pinsOfCompanies).not.toHaveBeenCalled();
  });

  it('permiso de una empresa: solo las marcaciones cuyo PIN es RFC de esa empresa', async () => {
    const page = await listPunches.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith({ permission: READ, companyId: 'company-a' }),
    });

    expect(pinsOfCompanies).toHaveBeenCalledWith(['company-a']);
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.pin)).toEqual([RFC_ANA]);
    expect(page.items[0]?.employee).toEqual({
      id: 'emp-ana',
      fullName: 'Ana Rojas',
      companyId: 'company-a',
    });
  });

  it('permisos de varias empresas: la unión de sus PIN', async () => {
    const page = await listPunches.execute({
      page: 1,
      pageSize: 20,
      actor: actorWith(
        { permission: READ, companyId: 'company-a' },
        { permission: READ, companyId: 'company-b' },
      ),
    });

    expect(page.items.map((item) => item.pin)).toEqual([RFC_LUIS, RFC_ANA]);
  });

  it('empresa sin RFC registrados: página vacía con la paginación pedida, sin pedir dueños', async () => {
    const page = await listPunches.execute({
      page: 3,
      pageSize: 5,
      actor: actorWith({ permission: READ, companyId: 'company-sin-rfc' }),
    });

    expect(page).toEqual({ items: [], total: 0, page: 3, pageSize: 5 });
    expect(ownersOf).not.toHaveBeenCalled();
  });

  it('los filtros del llamador se combinan con el alcance de la empresa (AND)', async () => {
    const actor = actorWith({ permission: READ, companyId: 'company-a' });
    const base = { page: 1, pageSize: 20, actor };

    const samePin = await listPunches.execute({ ...base, pin: RFC_ANA });
    const otherCompanyPin = await listPunches.execute({ ...base, pin: RFC_LUIS });
    // 08:00 Cancún = 13:00Z, anterior a `from`.
    const outOfRange = await listPunches.execute({ ...base, from: '2026-09-28T14:00:00.000Z' });

    expect(samePin.items.map((item) => item.pin)).toEqual([RFC_ANA]);
    // Pedir el PIN de otra empresa no saca su marcación del alcance.
    expect(otherCompanyPin).toMatchObject({ items: [], total: 0 });
    expect(outOfRange.total).toBe(0);
  });

  it('pide los dueños solo de los PIN de la página devuelta', async () => {
    await listPunches.execute({
      page: 1,
      pageSize: 1,
      actor: actorWith({ permission: READ, companyId: null }),
    });

    expect(ownersOf).toHaveBeenCalledWith(['1']);
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
