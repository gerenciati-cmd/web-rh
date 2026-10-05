import { describe, expect, it } from 'vitest';

import { API_ERRORS } from '../errors';

import { attendanceDeviceCommandRoutes } from './device-command.contract';
import { DeviceSchema, SetDeviceNetworksSchema, attendanceDeviceRoutes } from './device.contract';

describe('SetDeviceNetworksSchema', () => {
  it('acepta IPs y CIDR IPv4', () => {
    const body = { allowedNetworks: ['127.0.0.1', '10.0.0.0/24', '0.0.0.0/0', '10.1.2.3/32'] };

    expect(SetDeviceNetworksSchema.parse(body)).toEqual(body);
  });

  it('acepta la lista vacía (quita la restricción)', () => {
    expect(SetDeviceNetworksSchema.safeParse({ allowedNetworks: [] }).success).toBe(true);
  });

  it('acepta exactamente 10 redes y rechaza 11', () => {
    const list = (count: number) =>
      Array.from({ length: count }, (_, index) => `10.0.${index}.0/24`);

    expect(SetDeviceNetworksSchema.safeParse({ allowedNetworks: list(10) }).success).toBe(true);
    const tooMany = SetDeviceNetworksSchema.safeParse({ allowedNetworks: list(11) });
    expect(tooMany.success).toBe(false);
    expect(!tooMany.success && tooMany.error.issues[0]?.path).toEqual(['allowedNetworks']);
  });

  it.each([
    '10.0.0.0/33',
    '10.0.0.0/-1',
    '999.1.1.1',
    '10.0.0',
    'junk',
    '',
    '::1',
    '2001:db8::/32',
    '10.0.0.0/24/8',
  ])('rechaza el valor %j', (value) => {
    const result = SetDeviceNetworksSchema.safeParse({ allowedNetworks: [value] });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path[0]).toBe('allowedNetworks');
  });

  it.each([{}, { allowedNetworks: null }, { allowedNetworks: '127.0.0.1' }, { networks: [] }])(
    'rechaza el body %j',
    (body) => {
      expect(SetDeviceNetworksSchema.safeParse(body).success).toBe(false);
    },
  );
});

describe('DeviceSchema: campos de red', () => {
  const base = {
    id: '00000000-0000-4000-8000-000000000001',
    serialNumber: 'TESTSN001',
    name: 'Entrada',
    timeZone: 'America/Cancun',
    active: true,
    registeredAt: '2026-09-28T17:00:00.000Z',
    lastSeenAt: null,
    lastPunchAt: null,
    siteId: null,
    clockOffsetSeconds: null,
    clockOffsetMeasuredAt: null,
    clockSuspect: false,
    allowedNetworks: [],
    lastSeenIp: null,
  };

  it('acepta redes y la IP del último contacto', () => {
    const result = DeviceSchema.safeParse({
      ...base,
      allowedNetworks: ['10.0.0.0/24'],
      lastSeenIp: '10.0.0.5',
    });

    expect(result.success).toBe(true);
  });

  it.each(['allowedNetworks', 'lastSeenIp'])('exige el campo %s', (key) => {
    const { [key]: _omitted, ...rest } = base as Record<string, unknown>;

    const result = DeviceSchema.safeParse(rest);

    expect(!result.success && result.error.issues[0]?.path).toEqual([key]);
  });

  it('lastSeenIp acepta null pero no un número', () => {
    expect(DeviceSchema.safeParse({ ...base, lastSeenIp: null }).success).toBe(true);
    expect(DeviceSchema.safeParse({ ...base, lastSeenIp: 5 }).success).toBe(false);
  });
});

describe('setDeviceNetworks y el registro de errores', () => {
  it('setDeviceNetworks: PUT con deviceId UUID, 204, permiso de gestión sin empresa', () => {
    expect(attendanceDeviceRoutes.setDeviceNetworks).toMatchObject({
      method: 'PUT',
      path: '/attendance/devices/:deviceId/networks',
      successStatus: 204,
      errors: ['DEVICE_NOT_FOUND'],
      access: { kind: 'permission', permission: 'attendance.devices:manage' },
    });
    expect(attendanceDeviceRoutes.setDeviceNetworks.access).not.toHaveProperty('companyParam');
    expect(
      attendanceDeviceRoutes.setDeviceNetworks.params.safeParse({ deviceId: 'no-uuid' }).success,
    ).toBe(false);
  });

  it('DEVICE_NETWORK_UNRESTRICTED está registrado como 422 con ejemplo coherente', () => {
    const entry = API_ERRORS.DEVICE_NETWORK_UNRESTRICTED;

    expect(entry.status).toBe(422);
    expect(entry.examples.default.code).toBe('DEVICE_NETWORK_UNRESTRICTED');
    expect(entry.examples.default.details).toHaveProperty('deviceId');
  });

  it('queueDeviceCommand documenta DEVICE_NETWORK_UNRESTRICTED', () => {
    expect(attendanceDeviceCommandRoutes.queueDeviceCommand.errors).toContain(
      'DEVICE_NETWORK_UNRESTRICTED',
    );
  });
});
