import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../../domain/device';
import type { DevicePushRecord } from '../../domain/device-record';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceRepository,
  InMemoryPunchRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { RecordDevicePush, type RecordDevicePushInput } from './record-device-push.command';

/** Arma el comando con repositorios en memoria donde `registeredSerials` son equipos activos. */
async function setUp(registeredSerials: readonly string[]) {
  const logger = new RecordingLogger();
  const clock = new FixedClock();
  const idGenerator = new SequentialIdGenerator();
  const store = new InMemoryAttendanceStore();
  const deviceRepository = new InMemoryDeviceRepository(store);
  const punchRepository = new InMemoryPunchRepository(store);
  for (const serialNumber of registeredSerials) {
    const device = Device.register({
      id: idGenerator.next() as DeviceId,
      serialNumber,
      name: `Equipo ${serialNumber}`,
      timeZone: 'America/Cancun',
      now: clock.now(),
    });
    if (!device.ok) throw device.error;
    await deviceRepository.save(device.value);
  }
  return {
    logger,
    command: new RecordDevicePush({
      logger,
      deviceRepository,
      punchRepository,
      idGenerator,
      clock,
    }),
  };
}

describe('RecordDevicePush', () => {
  const attendanceRecord: DevicePushRecord = {
    kind: 'attendance',
    pin: '1',
    deviceTime: '2026-09-28 08:01:00',
    status: '0',
    verifyMode: '1',
    extraFields: 6,
  };

  it('rechaza un número de serie no registrado y no registra los datos', async () => {
    const { logger, command } = await setUp(['OTRO']);

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

  // Regresión de la reparación de revisión (deviación 7, hallazgo L3): `records` se lee solo
  // después de autorizar. El router lo pasa como getter para no parsear el body de un equipo no
  // autorizado; aquí se prueba en el propio comando, sin depender del router.
  it('no lee `records` cuando el número de serie no está autorizado', async () => {
    const { command } = await setUp(['OTRO']);
    let accessed = false;
    const input: RecordDevicePushInput = {
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      get records(): readonly DevicePushRecord[] {
        accessed = true;
        throw new Error('no debería leerse records de un equipo no autorizado');
      },
    };

    const result = await command.execute(input);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(accessed).toBe(false);
  });

  it('rechaza cualquier equipo cuando no hay equipos registrados', async () => {
    const { command } = await setUp([]);

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [],
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
  });

  it('acepta y devuelve el conteo de registros de un equipo registrado', async () => {
    const { command } = await setUp(['TESTSN001']);

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [attendanceRecord, attendanceRecord],
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toEqual({ accepted: 2 });
  });

  it('registra un resumen a nivel info con el conteo por tipo (kind)', async () => {
    const { logger, command } = await setUp(['TESTSN001']);
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
    const { logger, command } = await setUp(['TESTSN001']);
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
    const { logger, command } = await setUp(['TESTSN001']);

    await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [attendanceRecord],
    });

    // ATTLOG también persiste y deja su propio log (`marcaciones guardadas`): aquí solo importa
    // lo que existía antes de persistir.
    expect(logger.entries.slice(0, 2)).toEqual([
      expect.objectContaining({ level: 'info', msg: 'zkteco: datos recibidos' }),
      {
        level: 'debug',
        obj: { serialNumber: 'TESTSN001', table: 'ATTLOG', record: attendanceRecord },
        msg: 'zkteco: registro',
      },
    ]);
  });

  it('no registra el detalle de un registro cuando no hay datos', async () => {
    const { logger, command } = await setUp(['TESTSN001']);

    const result = await command.execute({
      serialNumber: 'TESTSN001',
      table: 'ATTLOG',
      records: [],
    });

    expect(result.ok && result.value).toEqual({ accepted: 0 });
    expect(logger.entries.filter((entry) => entry.level === 'debug')).toHaveLength(0);
    expect(logger.entries[0]).toMatchObject({ level: 'info' });
  });
});
