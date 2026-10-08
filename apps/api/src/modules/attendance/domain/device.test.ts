import { describe, expect, it } from 'vitest';

import {
  CLOCK_OFFSET_TOLERANCE_SECONDS,
  Device,
  DEVICE_REGISTERED,
  DEVICE_SEEN_RESOLUTION_MS,
  type DeviceId,
} from './device';

const ID = '00000000-0000-4000-8000-000000000001' as DeviceId;
const NOW = new Date('2026-09-28T17:00:00Z');

function register(
  overrides: Partial<{ serialNumber: string; name: string; timeZone: string }> = {},
) {
  return Device.register({
    id: ID,
    serialNumber: 'TESTSN001',
    name: 'Entrada principal',
    siteId: '00000000-0000-4000-8000-0000000000a1',
    timeZone: 'America/Cancun',
    now: NOW,
    ...overrides,
  });
}

function registered(): Device {
  const result = register();
  if (!result.ok) throw result.error;
  return result.value;
}

describe('Device.register', () => {
  it('crea un equipo activo, sin último contacto, y registra el evento de alta', () => {
    const device = registered();

    expect(device.serialNumber).toBe('TESTSN001');
    expect(device.name).toBe('Entrada principal');
    expect(device.timeZone).toBe('America/Cancun');
    expect(device.active).toBe(true);
    expect(device.registeredAt).toEqual(NOW);
    expect(device.lastSeenAt).toBeNull();
    const events = device.pullEvents();
    expect(events.map((event) => event.name)).toEqual([DEVICE_REGISTERED]);
    expect(events[0]?.payload).toEqual({ deviceId: ID, serialNumber: 'TESTSN001' });
  });

  it('recorta espacios del serial, el nombre y la zona', () => {
    const result = register({ serialNumber: ' TESTSN001 ', name: '  Puerta  ', timeZone: ' UTC ' });

    expect(result.ok && result.value.serialNumber).toBe('TESTSN001');
    expect(result.ok && result.value.name).toBe('Puerta');
    expect(result.ok && result.value.timeZone).toBe('UTC');
  });

  it.each(['', '   ', 'SN 001', 'SN-001', 'ñandú', 'A'.repeat(65)])(
    'rechaza el número de serie %j',
    (serialNumber) => {
      const result = register({ serialNumber });
      expect(!result.ok && result.error.message).toBe('Número de serie inválido');
    },
  );

  it('acepta un serial de 64 caracteres', () => {
    expect(register({ serialNumber: 'A'.repeat(64) }).ok).toBe(true);
  });

  it('rechaza un nombre vacío o solo espacios', () => {
    const result = register({ name: '   ' });
    expect(!result.ok && result.error.message).toBe('El nombre del equipo es obligatorio');
  });

  it('rechaza un nombre de más de 100 caracteres y acepta uno de 100', () => {
    const tooLong = register({ name: 'x'.repeat(101) });
    expect(!tooLong.ok && tooLong.error.message).toBe('El nombre del equipo es demasiado largo');
    expect(register({ name: 'x'.repeat(100) }).ok).toBe(true);
  });

  it('rechaza una zona horaria inválida', () => {
    const result = register({ timeZone: 'Mars/Olympus' });
    expect(!result.ok && result.error.message).toBe('Zona horaria inválida');
  });
});

describe('Device.register (sede y desfase)', () => {
  it('guarda la sede y la zona recibidas, y nace sin medición de desfase', () => {
    const device = registered();

    expect(device.siteId).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(device.clockOffsetSeconds).toBeNull();
    expect(device.clockOffsetMeasuredAt).toBeNull();
    expect(device.clockSuspect).toBe(false);
  });
});

describe('Device.assignSite', () => {
  it('cambia la sede y copia la zona horaria de la nueva sede', () => {
    const device = registered();

    device.assignSite(
      '00000000-0000-4000-8000-0000000000b2',
      'America/Mexico_City',
      new Date('2026-10-08T12:00:00Z'),
    );

    expect(device.siteId).toBe('00000000-0000-4000-8000-0000000000b2');
    expect(device.timeZone).toBe('America/Mexico_City');
  });

  it('asigna la sede a un equipo rehidratado sin sede (registrado antes del plan)', () => {
    const device = Device.restore(ID, {
      serialNumber: 'TESTSN001',
      name: 'Entrada',
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

    device.assignSite(
      '00000000-0000-4000-8000-0000000000a1',
      'America/Cancun',
      new Date('2026-10-08T12:00:00Z'),
    );

    expect(device.siteId).toBe('00000000-0000-4000-8000-0000000000a1');
    expect(device.timeZone).toBe('America/Cancun');
  });
});

describe('Device.recordClockOffset y clockSuspect', () => {
  it('guarda el desfase y el instante de la medición', () => {
    const device = registered();
    const measuredAt = new Date(NOW.getTime() + 5000);

    device.recordClockOffset(12, measuredAt);

    expect(device.clockOffsetSeconds).toBe(12);
    expect(device.clockOffsetMeasuredAt).toEqual(measuredAt);
  });

  it('una nueva medición reemplaza la anterior', () => {
    const device = registered();
    device.recordClockOffset(400, NOW);

    device.recordClockOffset(3, new Date(NOW.getTime() + 1000));

    expect(device.clockOffsetSeconds).toBe(3);
    expect(device.clockSuspect).toBe(false);
  });

  it('la tolerancia es de 300 segundos', () => {
    expect(CLOCK_OFFSET_TOLERANCE_SECONDS).toBe(300);
  });

  it.each([
    [0, false],
    [300, false],
    [-300, false],
    [301, true],
    [-301, true],
    [-3600, true],
  ])('desfase de %i s: clockSuspect = %s', (seconds, suspect) => {
    const device = registered();

    device.recordClockOffset(seconds, NOW);

    expect(device.clockSuspect).toBe(suspect);
  });
});

describe('Device.markSeen', () => {
  it('la primera vez anota el contacto y pide persistir', () => {
    const device = registered();
    const seenAt = new Date(NOW.getTime() + 1000);

    expect(device.markSeen(seenAt, null)).toBe(true);
    expect(device.lastSeenAt).toEqual(seenAt);
  });

  it('dentro de la resolución no cambia nada ni pide persistir', () => {
    const device = registered();
    const first = new Date(NOW.getTime() + 1000);
    device.markSeen(first, null);

    const shortlyAfter = new Date(first.getTime() + DEVICE_SEEN_RESOLUTION_MS - 1);
    expect(device.markSeen(shortlyAfter, null)).toBe(false);
    expect(device.lastSeenAt).toEqual(first);
  });

  it('exactamente al cumplirse la resolución vuelve a anotar', () => {
    const device = registered();
    const first = new Date(NOW.getTime() + 1000);
    device.markSeen(first, null);

    const exactly = new Date(first.getTime() + DEVICE_SEEN_RESOLUTION_MS);
    expect(device.markSeen(exactly, null)).toBe(true);
    expect(device.lastSeenAt).toEqual(exactly);
  });
});

describe('Device.restore', () => {
  it('rehidrata sin emitir eventos', () => {
    const device = Device.restore(ID, {
      serialNumber: 'TESTSN001',
      name: 'Entrada',
      timeZone: 'UTC',
      active: false,
      registeredAt: NOW,
      lastSeenAt: NOW,
      siteId: null,
      clockOffsetSeconds: null,
      clockOffsetMeasuredAt: null,
      allowedNetworks: [],
      lastSeenIp: null,
    });

    expect(device.active).toBe(false);
    expect(device.pullEvents()).toEqual([]);
  });
});
