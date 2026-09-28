import { describe, expect, it } from 'vitest';

import { RecordingLogger } from '@/shared/testing/fakes';

import type { DevicePushRecord } from '../../domain/device-record';

import { RecordDevicePush } from './record-device-push.command';

describe('RecordDevicePush', () => {
  const attendanceRecord: DevicePushRecord = {
    kind: 'attendance',
    pin: '1',
    deviceTime: '2026-09-28 08:01:00',
    status: '0',
    verifyMode: '1',
    extraFields: 6,
  };

  it('rechaza un número de serie fuera de la lista permitida y no registra los datos', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['OTRO'] });

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [attendanceRecord],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: { serialNumber: 'TESTSN001', table: 'ATTLOG' },
        msg: 'zkteco: dispositivo no autorizado',
      },
    ]);
  });

  it('rechaza cualquier equipo cuando la lista permitida está vacía', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: [] });

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
  });

  it('acepta y devuelve el conteo de registros de un equipo permitido', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['TESTSN001'] });

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [attendanceRecord, attendanceRecord],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ accepted: 2 });
  });

  it('registra un resumen a nivel info con el conteo por tipo (kind)', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['TESTSN001'] });
    const operationRecord: DevicePushRecord = {
      kind: 'operation',
      code: '7',
      adminPin: '0',
      deviceTime: '2026-09-28 10:47:19',
      objects: [],
    };

    await command.execute({
      serialNumber: 'TESTSN001',
      table: 'OPERLOG',
      records: [attendanceRecord, operationRecord, operationRecord],
    });

    expect(logger.entries[0]).toEqual({
      level: 'info',
      obj: {
        serialNumber: 'TESTSN001',
        table: 'OPERLOG',
        total: 3,
        byKind: { attendance: 1, operation: 2 },
      },
      msg: 'zkteco: datos recibidos',
    });
  });

  it('cuenta los registros entry por su prefijo, no por kind', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['TESTSN001'] });
    const userEntry: DevicePushRecord = { kind: 'entry', prefix: 'USER', fields: {} };
    const biodataEntry: DevicePushRecord = { kind: 'entry', prefix: 'BIODATA', fields: {} };

    await command.execute({
      serialNumber: 'TESTSN001',
      table: 'OPERLOG',
      records: [userEntry, biodataEntry],
    });

    expect(logger.entries[0]).toMatchObject({
      obj: { byKind: { USER: 1, BIODATA: 1 } },
    });
  });

  it('registra cada registro individual a nivel debug', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['TESTSN001'] });

    await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [attendanceRecord],
    });

    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'info', msg: 'zkteco: datos recibidos' }),
      {
        level: 'debug',
        obj: { serialNumber: 'TESTSN001', table: 'ATTLOG', record: attendanceRecord },
        msg: 'zkteco: registro',
      },
    ]);
  });

  it('no registra el detalle de un registro cuando no hay datos', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDevicePush({ logger, allowedDeviceSerials: ['TESTSN001'] });

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [],
    });

    expect(result.ok && result.value).toEqual({ accepted: 0 });
    expect(logger.entries).toHaveLength(1);
    expect(logger.entries[0]).toMatchObject({ level: 'info' });
  });
});
