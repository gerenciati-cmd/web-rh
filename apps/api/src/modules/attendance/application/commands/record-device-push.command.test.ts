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
      siteId: '00000000-0000-4000-8000-0000000000a1',
      timeZone: 'America/Cancun',
      now: clock.now(),
    });
    if (!device.ok) throw device.error;
    await deviceRepository.save(device.value);
  }
  return {
    logger,
    clock,
    store,
    deviceRepository,
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

  describe('persistencia de marcaciones (plan 001)', () => {
    const second: DevicePushRecord = { ...attendanceRecord, pin: '2', verifyMode: '15' };

    function savedLog(logger: { entries: { msg?: string; obj: object }[] }) {
      return logger.entries.find((entry) => entry.msg === 'zkteco: marcaciones guardadas');
    }

    it('guarda cada marcación ATTLOG con su hora local y su instante UTC', async () => {
      const { command, store } = await setUp(['TESTSN001']);

      await command.execute({
        serialNumber: 'TESTSN001',
        table: 'ATTLOG',
        records: [attendanceRecord, second],
      });

      const punches = [...store.punches.values()];
      expect(punches).toHaveLength(2);
      expect(punches.map((punch) => punch.pin)).toEqual(['1', '2']);
      expect(punches[0]?.deviceLocalTime).toBe('2026-09-28 08:01:00');
      expect(punches[0]?.occurredAt.toISOString()).toBe('2026-09-28T13:01:00.000Z');
      expect(punches[1]?.verifyMode).toBe('15');
    });

    it('reenviar el mismo historial no duplica y el log distingue insertadas de duplicadas', async () => {
      const { command, store, logger } = await setUp(['TESTSN001']);
      const input = {
        serialNumber: 'TESTSN001',
        table: 'ATTLOG',
        records: [attendanceRecord, second],
      };

      const first = await command.execute(input);
      const again = await command.execute(input);

      expect(first.ok && first.value).toEqual({ accepted: 2 });
      expect(again.ok && again.value).toEqual({ accepted: 2 });
      expect(store.punches.size).toBe(2);
      const logs = logger.entries.filter((entry) => entry.msg === 'zkteco: marcaciones guardadas');
      expect(logs.map((entry) => entry.obj)).toEqual([
        { serialNumber: 'TESTSN001', received: 2, inserted: 2, duplicates: 0, rejected: 0 },
        { serialNumber: 'TESTSN001', received: 2, inserted: 0, duplicates: 2, rejected: 0 },
      ]);
    });

    it('una línea con fecha imposible no se guarda, se avisa y aun así cuenta en accepted', async () => {
      const { command, store, logger } = await setUp(['TESTSN001']);
      const impossible: DevicePushRecord = {
        ...attendanceRecord,
        pin: '9',
        deviceTime: '2026-02-30 08:00:00',
      };

      const result = await command.execute({
        serialNumber: 'TESTSN001',
        table: 'ATTLOG',
        records: [attendanceRecord, impossible],
      });

      expect(result.ok && result.value).toEqual({ accepted: 2 });
      expect([...store.punches.values()].map((punch) => punch.pin)).toEqual(['1']);
      expect(logger.entries).toContainEqual({
        level: 'warn',
        obj: {
          serialNumber: 'TESTSN001',
          pin: '9',
          deviceTime: '2026-02-30 08:00:00',
          reason: 'Fecha y hora del equipo inválida',
        },
        msg: 'zkteco: marcación rechazada',
      });
      expect(savedLog(logger)?.obj).toEqual({
        serialNumber: 'TESTSN001',
        received: 2,
        inserted: 1,
        duplicates: 0,
        rejected: 1,
      });
    });

    it('reconoce la tabla ATTLOG sin distinguir mayúsculas', async () => {
      const { command, store } = await setUp(['TESTSN001']);

      await command.execute({
        serialNumber: 'TESTSN001',
        table: 'attlog',
        records: [attendanceRecord],
      });

      expect(store.punches.size).toBe(1);
    });

    it('ignora los registros que no son de asistencia dentro de ATTLOG', async () => {
      const { command, store, logger } = await setUp(['TESTSN001']);
      const userEntry: DevicePushRecord = { kind: 'entry', prefix: 'USER', fields: {} };

      const result = await command.execute({
        serialNumber: 'TESTSN001',
        table: 'ATTLOG',
        records: [attendanceRecord, userEntry],
      });

      expect(result.ok && result.value).toEqual({ accepted: 2 });
      expect(store.punches.size).toBe(1);
      expect(savedLog(logger)?.obj).toMatchObject({ received: 1, inserted: 1 });
    });

    it.each(['OPERLOG', 'OPLOG', 'USER', 'BIODATA', 'options'])(
      'un push de la tabla %s no escribe marcaciones ni deja el log de guardado',
      async (table) => {
        const { command, store, logger } = await setUp(['TESTSN001']);

        const result = await command.execute({
          serialNumber: 'TESTSN001',
          table,
          records: [attendanceRecord],
        });

        expect(result.ok && result.value).toEqual({ accepted: 1 });
        expect(store.punches.size).toBe(0);
        expect(savedLog(logger)).toBeUndefined();
      },
    );

    it('un equipo inactivo es rechazado y no guarda nada', async () => {
      const { command, store, deviceRepository, logger } = await setUp([]);
      await deviceRepository.save(inactiveDevice('TESTSN001'));

      const result = await command.execute({
        serialNumber: 'TESTSN001',
        table: 'ATTLOG',
        records: [attendanceRecord],
      });

      expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
      expect(store.punches.size).toBe(0);
      expect(logger.entries).toEqual([
        expect.objectContaining({ level: 'warn', msg: 'zkteco: dispositivo no autorizado' }),
      ]);
    });

    it('anota el último contacto del equipo, y no lo reescribe dentro del minuto', async () => {
      const { command, clock, deviceRepository } = await setUp(['TESTSN001']);
      const input = { serialNumber: 'TESTSN001', table: 'ATTLOG', records: [attendanceRecord] };
      const t0 = new Date('2026-01-15T12:00:00Z');
      clock.set(t0);

      await command.execute(input);
      expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(t0);

      clock.set(new Date(t0.getTime() + 30_000));
      await command.execute(input);
      expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(t0);

      const later = new Date(t0.getTime() + 60_000);
      clock.set(later);
      await command.execute(input);
      expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(later);
    });

    describe('desfase de reloj (plan attendance-marcaciones/003)', () => {
      // FixedClock por defecto: 2026-01-15T12:00:00Z, que en America/Cancun (UTC-5) son las 07:00.
      const SYNCED = '2026-01-15 07:00:00';
      const line = (deviceTime: string): DevicePushRecord => ({
        ...attendanceRecord,
        deviceTime,
      });
      const push = (records: readonly DevicePushRecord[], table = 'ATTLOG') => ({
        serialNumber: 'TESTSN001',
        table,
        records,
      });

      it('un envío de una sola línea sincronizada mide desfase 0 y no es sospechoso', async () => {
        const { command, deviceRepository, logger, clock } = await setUp(['TESTSN001']);

        await command.execute(push([line(SYNCED)]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(0);
        expect(device?.clockOffsetMeasuredAt).toEqual(clock.now());
        expect(device?.clockSuspect).toBe(false);
        expect(logger.entries.some((entry) => entry.msg === 'zkteco: desfase de reloj')).toBe(
          false,
        );
      });

      it('una marcación sellada una hora adelante mide -3600 s, es sospechosa y avisa con warn', async () => {
        const { command, deviceRepository, logger } = await setUp(['TESTSN001']);

        await command.execute(push([line('2026-01-15 08:00:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(-3600);
        expect(device?.clockSuspect).toBe(true);
        expect(logger.entries).toContainEqual({
          level: 'warn',
          obj: { serialNumber: 'TESTSN001', offsetSeconds: -3600 },
          msg: 'zkteco: desfase de reloj',
        });
      });

      it('un reloj atrasado más de 5 minutos mide un desfase positivo y es sospechoso', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);

        await command.execute(push([line('2026-01-15 06:50:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(600);
        expect(device?.clockSuspect).toBe(true);
      });

      it('exactamente 300 s de desfase aún está dentro de la tolerancia', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);

        await command.execute(push([line('2026-01-15 06:55:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(300);
        expect(device?.clockSuspect).toBe(false);
      });

      it('un envío de varias líneas (historial) no mide ni cambia el desfase previo', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);
        await command.execute(push([line('2026-01-15 08:00:00')]));

        await command.execute(push([line('2026-01-14 08:00:00'), line('2026-01-14 09:00:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(-3600);
      });

      it('una sola línea ya guardada (reenvío del historial) no mide ni cambia el desfase previo', async () => {
        const { command, deviceRepository, logger, clock } = await setUp(['TESTSN001']);
        await command.execute(push([line(SYNCED)]));

        // Seis horas después el equipo reenvía la misma marcación tras un handshake.
        clock.set(new Date(clock.now().getTime() + 6 * 3600_000));
        await command.execute(push([line(SYNCED)]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBe(0);
        expect(device?.clockSuspect).toBe(false);
        expect(logger.entries.some((entry) => entry.msg === 'zkteco: desfase de reloj')).toBe(
          false,
        );
      });

      it('un historial en un equipo sin mediciones lo deja sin desfase', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);

        await command.execute(push([line('2026-01-14 08:00:00'), line('2026-01-14 09:00:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.clockOffsetSeconds).toBeNull();
        expect(device?.clockOffsetMeasuredAt).toBeNull();
      });

      it('una línea rechazada no cuenta: con una sola válida entre dos se mide', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);

        await command.execute(push([line(SYNCED), line('2026-02-30 08:00:00')]));

        expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.clockOffsetSeconds).toBe(
          0,
        );
      });

      it('las tablas que no son ATTLOG no miden desfase', async () => {
        const { command, deviceRepository } = await setUp(['TESTSN001']);

        await command.execute(push([line(SYNCED)], 'OPERLOG'));

        expect(
          (await deviceRepository.findBySerialNumber('TESTSN001'))?.clockOffsetSeconds,
        ).toBeNull();
      });

      it('una medición nueva dentro del minuto se persiste aunque lastSeenAt no se reescriba', async () => {
        const { command, deviceRepository, clock } = await setUp(['TESTSN001']);
        await command.execute(push([line(SYNCED)]));
        const firstSeen = clock.now();

        clock.set(new Date(firstSeen.getTime() + 30_000));
        await command.execute(push([line('2026-01-15 08:01:00')]));

        const device = await deviceRepository.findBySerialNumber('TESTSN001');
        expect(device?.lastSeenAt).toEqual(firstSeen);
        expect(device?.clockOffsetSeconds).toBe(-3630);
        expect(device?.clockOffsetMeasuredAt).toEqual(clock.now());
      });
    });

    it('la hora local se interpreta con la zona del equipo que empuja', async () => {
      const { command, store, deviceRepository } = await setUp([]);
      await deviceRepository.save(
        Device.restore('00000000-0000-4000-8000-0000000000aa' as DeviceId, {
          serialNumber: 'UTCDEVICE',
          name: 'Equipo UTC',
          timeZone: 'UTC',
          active: true,
          registeredAt: new Date('2026-01-15T12:00:00Z'),
          lastSeenAt: null,
          siteId: null,
          clockOffsetSeconds: null,
          clockOffsetMeasuredAt: null,
        }),
      );

      await command.execute({
        serialNumber: 'UTCDEVICE',
        table: 'ATTLOG',
        records: [attendanceRecord],
      });

      expect([...store.punches.values()][0]?.occurredAt.toISOString()).toBe(
        '2026-09-28T08:01:00.000Z',
      );
    });
  });
});

function inactiveDevice(serialNumber: string): Device {
  return Device.restore('00000000-0000-4000-8000-0000000000bb' as DeviceId, {
    serialNumber,
    name: 'Equipo inactivo',
    timeZone: 'America/Cancun',
    active: false,
    registeredAt: new Date('2026-01-15T12:00:00Z'),
    lastSeenAt: null,
    siteId: null,
    clockOffsetSeconds: null,
    clockOffsetMeasuredAt: null,
  });
}
