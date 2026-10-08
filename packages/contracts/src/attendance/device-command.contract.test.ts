import { describe, expect, it } from 'vitest';

import {
  DEVICE_COMMAND_PATTERN,
  DeviceCommandSchema,
  QueueDeviceCommandSchema,
  attendanceDeviceCommandRoutes,
} from './device-command.contract';

describe('QueueDeviceCommandSchema', () => {
  it.each([
    'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas',
    'DATA QUERY USERINFO PIN=1',
    'DATA DELETE USERINFO PIN=1',
  ])('acepta el comando USERINFO %j', (command) => {
    expect(QueueDeviceCommandSchema.safeParse({ command }).success).toBe(true);
  });

  it.each([
    'CLEAR DATA',
    'REBOOT',
    'DATA UPDATE BIODATA Pin=1',
    'DATA UPDATE USERINFO',
    // Plan 006: el prefijo C:<n>: lo asigna el API.
    'C:12:DATA UPDATE USERINFO PIN=1',
    // Hallazgo H1 de la revisión: un salto de línea colaría un segundo comando.
    'DATA QUERY USERINFO PIN=1\nC:99:CLEAR DATA',
    'DATA QUERY USERINFO PIN=1\rCLEAR DATA',
  ])('rechaza el comando %j', (command) => {
    const result = QueueDeviceCommandSchema.safeParse({ command });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.issues[0]?.path).toEqual(['command']);
  });

  it('no recorta espacios: el tabulador final y los iniciales cuentan', () => {
    const withTab = 'DATA UPDATE USERINFO PIN=1\t';
    const parsed = QueueDeviceCommandSchema.parse({ command: withTab });

    expect(parsed.command).toBe(withTab);
    expect(
      QueueDeviceCommandSchema.safeParse({ command: ' DATA UPDATE USERINFO PIN=1' }).success,
    ).toBe(false);
  });

  it('acepta 500 caracteres y rechaza 501 o vacío', () => {
    const prefix = 'DATA UPDATE USERINFO ';
    const of = (length: number) => ({ command: prefix + 'x'.repeat(length - prefix.length) });

    expect(QueueDeviceCommandSchema.safeParse(of(500)).success).toBe(true);
    expect(QueueDeviceCommandSchema.safeParse(of(501)).success).toBe(false);
    expect(QueueDeviceCommandSchema.safeParse({ command: '' }).success).toBe(false);
  });

  it('rechaza un cuerpo sin command o con command que no es texto', () => {
    expect(QueueDeviceCommandSchema.safeParse({}).success).toBe(false);
    expect(QueueDeviceCommandSchema.safeParse({ command: 5 }).success).toBe(false);
  });

  it('exporta el patrón usado por el esquema', () => {
    expect(DEVICE_COMMAND_PATTERN.test('DATA UPDATE USERINFO PIN=1')).toBe(true);
    expect(DEVICE_COMMAND_PATTERN.test('DATA UPDATE OPTIONS x=1')).toBe(false);
  });
});

describe('DeviceCommandSchema', () => {
  const valid = {
    id: '00000000-0000-4000-8000-0000000000c1',
    number: 1,
    command: 'DATA QUERY USERINFO PIN=1',
    status: 'QUEUED',
    queuedAt: '2026-10-02T12:00:00.000Z',
    sentAt: null,
    returnCode: null,
    completedAt: null,
    queuedBy: '00000000-0000-4000-8000-0000000000a1',
  };

  it('acepta QUEUED sin sentAt y SENT con sentAt', () => {
    expect(DeviceCommandSchema.safeParse(valid).success).toBe(true);
    expect(
      DeviceCommandSchema.safeParse({
        ...valid,
        status: 'SENT',
        sentAt: '2026-10-02T12:00:10.000Z',
      }).success,
    ).toBe(true);
  });

  it('rechaza un estado desconocido', () => {
    // Plan 006: FAILED pasó a ser un estado válido; se prueba con uno inexistente.
    expect(DeviceCommandSchema.safeParse({ ...valid, status: 'CANCELLED' }).success).toBe(false);
  });

  it('acepta DONE y FAILED con returnCode y completedAt', () => {
    const done = {
      ...valid,
      status: 'DONE',
      sentAt: '2026-10-02T12:00:05.000Z',
      returnCode: '0',
      completedAt: '2026-10-02T12:00:10.000Z',
    };
    const failed = { ...done, status: 'FAILED', returnCode: '-1' };

    expect(DeviceCommandSchema.safeParse(done).success).toBe(true);
    expect(DeviceCommandSchema.safeParse(failed).success).toBe(true);
  });

  it('rechaza returnCode o completedAt que no sean texto/fecha ISO', () => {
    expect(DeviceCommandSchema.safeParse({ ...valid, returnCode: 0 }).success).toBe(false);
    expect(DeviceCommandSchema.safeParse({ ...valid, completedAt: '2026-10-02' }).success).toBe(
      false,
    );
  });
});

describe('attendanceDeviceCommandRoutes', () => {
  it('encolar es POST con 201 y requiere attendance.devices:manage', () => {
    const route = attendanceDeviceCommandRoutes.queueDeviceCommand;

    expect(route.method).toBe('POST');
    expect(route.path).toBe('/attendance/devices/:deviceId/commands');
    expect(route.successStatus).toBe(201);
    expect(route.access).toEqual({ kind: 'permission', permission: 'attendance.devices:manage' });
  });

  it('listar es GET y también requiere attendance.devices:manage', () => {
    const route = attendanceDeviceCommandRoutes.listDeviceCommands;

    expect(route.method).toBe('GET');
    expect(route.path).toBe('/attendance/devices/:deviceId/commands');
    expect(route.access).toEqual({ kind: 'permission', permission: 'attendance.devices:manage' });
  });
});
