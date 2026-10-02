import { describe, expect, it } from 'vitest';

import { RegisterDeviceSchema, attendanceDeviceRoutes } from './device.contract';

describe('RegisterDeviceSchema', () => {
  const valid = { serialNumber: 'TESTSN001', name: 'Entrada', timeZone: 'America/Cancun' };

  it('acepta un alta válida y recorta espacios', () => {
    const parsed = RegisterDeviceSchema.parse({
      serialNumber: ' TESTSN001 ',
      name: '  Entrada ',
      timeZone: ' America/Cancun ',
    });

    expect(parsed).toEqual(valid);
  });

  it.each(['', 'SN 1', 'SN-1', 'A'.repeat(65)])('rechaza el serial %j', (serialNumber) => {
    const result = RegisterDeviceSchema.safeParse({ ...valid, serialNumber });
    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['serialNumber']);
  });

  it('acepta un serial de 64 caracteres', () => {
    expect(RegisterDeviceSchema.safeParse({ ...valid, serialNumber: 'A'.repeat(64) }).success).toBe(
      true,
    );
  });

  it.each(['', '   ', 'x'.repeat(101)])('rechaza el nombre %j', (name) => {
    const result = RegisterDeviceSchema.safeParse({ ...valid, name });
    expect(!result.success && result.error.issues[0]?.path).toEqual(['name']);
  });

  it('rechaza una zona horaria inválida con el mismo mensaje del dominio', () => {
    const result = RegisterDeviceSchema.safeParse({ ...valid, timeZone: 'Mars/Olympus' });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['timeZone']);
    expect(!result.success && result.error.issues[0]?.message).toBe('Zona horaria inválida');
  });

  it('rechaza un body al que le falta un campo', () => {
    expect(RegisterDeviceSchema.safeParse({ serialNumber: 'TESTSN001' }).success).toBe(false);
  });
});

describe('attendanceDeviceRoutes', () => {
  it('listDevices y registerDevice: método, path, estado y permiso sin empresa', () => {
    expect(attendanceDeviceRoutes.listDevices).toMatchObject({
      method: 'GET',
      path: '/attendance/devices',
      access: { kind: 'permission', permission: 'attendance.devices:read' },
    });
    expect(attendanceDeviceRoutes.registerDevice).toMatchObject({
      method: 'POST',
      path: '/attendance/devices',
      successStatus: 201,
      access: { kind: 'permission', permission: 'attendance.devices:manage' },
    });
    expect(attendanceDeviceRoutes.listDevices.access).not.toHaveProperty('companyParam');
    expect(attendanceDeviceRoutes.registerDevice.access).not.toHaveProperty('companyParam');
  });
});
