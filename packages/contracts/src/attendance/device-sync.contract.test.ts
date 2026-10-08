import { describe, expect, it } from 'vitest';

import { API_ERRORS } from '../errors';

import { DeviceSyncResultSchema, attendanceDeviceRoutes } from './device.contract';

const EMPLOYEE_ID = '00000000-0000-4000-8000-0000000000e1';

describe('DeviceSyncResultSchema', () => {
  const valid = {
    queued: 2,
    removed: 1,
    skipped: [{ employeeId: EMPLOYEE_ID, fullName: 'Luis Antiguo', reason: 'NO_RFC' }],
  };

  it('acepta un resultado con colaboradores omitidos y uno vacío', () => {
    expect(DeviceSyncResultSchema.safeParse(valid).success).toBe(true);
    expect(DeviceSyncResultSchema.safeParse({ queued: 0, removed: 0, skipped: [] }).success).toBe(
      true,
    );
  });

  it.each([
    ['queued fraccionario', { ...valid, queued: 1.5 }],
    ['removed como texto', { ...valid, removed: '1' }],
    ['skipped ausente', { queued: 0, removed: 0 }],
    ['razón desconocida', { ...valid, skipped: [{ ...valid.skipped[0], reason: 'OTRA' }] }],
    [
      'employeeId que no es uuid',
      { ...valid, skipped: [{ ...valid.skipped[0], employeeId: 'x' }] },
    ],
  ])('rechaza %s', (_name, body) => {
    expect(DeviceSyncResultSchema.safeParse(body).success).toBe(false);
  });
});

describe('syncDevice y el registro de errores', () => {
  it('syncDevice: POST con deviceId UUID, 200, permiso de gestión sin empresa y los tres errores', () => {
    expect(attendanceDeviceRoutes.syncDevice).toMatchObject({
      method: 'POST',
      path: '/attendance/devices/:deviceId/sync',
      errors: ['DEVICE_NOT_FOUND', 'DEVICE_WITHOUT_SITE', 'DEVICE_NETWORK_UNRESTRICTED'],
      access: { kind: 'permission', permission: 'attendance.devices:manage' },
    });
    expect(attendanceDeviceRoutes.syncDevice.access).not.toHaveProperty('companyParam');
    expect(attendanceDeviceRoutes.syncDevice.response).toBe(DeviceSyncResultSchema);
    expect(
      attendanceDeviceRoutes.syncDevice.params.safeParse({ deviceId: 'no-uuid' }).success,
    ).toBe(false);
  });

  it('DEVICE_WITHOUT_SITE está registrado como 422 con ejemplo coherente', () => {
    const entry = API_ERRORS.DEVICE_WITHOUT_SITE;

    expect(entry.status).toBe(422);
    expect(entry.examples.default.code).toBe('DEVICE_WITHOUT_SITE');
    expect(entry.examples.default.details).toHaveProperty('deviceId');
  });
});
