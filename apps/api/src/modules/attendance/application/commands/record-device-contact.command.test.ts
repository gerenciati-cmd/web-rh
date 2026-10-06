import { describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingLogger, SequentialIdGenerator } from '@/shared/testing/fakes';

import { Device, type DeviceId } from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import {
  RecordDeviceContact,
  type RecordDeviceContactInput,
} from './record-device-contact.command';

/** Arma el comando con un repositorio en memoria donde `registeredSerials` son equipos activos. */
async function setUp(registeredSerials: readonly string[]) {
  const logger = new RecordingLogger();
  const clock = new FixedClock();
  const idGenerator = new SequentialIdGenerator();
  const deviceRepository = new InMemoryDeviceRepository(new InMemoryAttendanceStore());
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
    deviceRepository,
    command: new RecordDeviceContact({ logger, deviceRepository, clock }),
  };
}

describe('RecordDeviceContact', () => {
  const baseInput: RecordDeviceContactInput = {
    serialNumber: 'TESTSN001',
    kind: 'handshake',
    method: 'GET',
    path: '/iclock/cdata',
    query: { SN: 'TESTSN001' },
    bodyLength: 0,
    body: '',
  };

  it('rechaza un número de serie no registrado y no autoriza', async () => {
    const { logger, command } = await setUp(['OTRO']);

    const result = await command.execute(baseInput);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(logger.entries).toEqual([
      {
        level: 'warn',
        obj: expect.objectContaining({ serialNumber: 'TESTSN001' }),
        msg: 'zkteco: dispositivo no autorizado',
      },
    ]);
  });

  it('rechaza cualquier equipo cuando no hay equipos registrados', async () => {
    const { command } = await setUp([]);

    const result = await command.execute(baseInput);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
  });

  it('registra a nivel info un contacto que no es poll', async () => {
    const { logger, command } = await setUp(['TESTSN001']);

    const result = await command.execute(baseInput);

    expect(result.ok).toBe(true);
    expect(logger.entries).toEqual([
      // El cuerpo nunca se registra tal cual (toEqual trata `undefined` como ausente).
      {
        level: 'info',
        obj: { ...baseInput, body: undefined },
        msg: 'zkteco: contacto del dispositivo',
      },
    ]);
  });

  it('registra a nivel debug un contacto de tipo poll', async () => {
    const { logger, command } = await setUp(['TESTSN001']);
    const pollInput: RecordDeviceContactInput = {
      ...baseInput,
      kind: 'poll',
      path: '/iclock/getrequest',
    };

    const result = await command.execute(pollInput);

    expect(result.ok).toBe(true);
    expect(logger.entries).toEqual([
      {
        level: 'debug',
        obj: { ...pollInput, body: undefined },
        msg: 'zkteco: contacto del dispositivo',
      },
    ]);
  });

  it('devuelve el id del equipo para que el router le entregue su comando', async () => {
    const { command, deviceRepository } = await setUp(['TESTSN001']);

    const result = await command.execute(baseInput);

    const device = await deviceRepository.findBySerialNumber('TESTSN001');
    expect(result.ok && result.value).toEqual({ deviceId: device?.id });
  });

  describe('resultado de comando (devicecmd)', () => {
    const resultInput: RecordDeviceContactInput = {
      ...baseInput,
      kind: 'command-result',
      method: 'POST',
      path: '/iclock/devicecmd',
    };

    it('registra ID, Return y CMD y redacta los demás campos', async () => {
      const { logger, command } = await setUp(['TESTSN001']);
      const body = 'ID=1&Return=0&CMD=DATA&Name=Ana Rojas';

      const result = await command.execute({ ...resultInput, body, bodyLength: body.length });

      expect(result.ok).toBe(true);
      expect(logger.entries).toContainEqual({
        level: 'info',
        obj: {
          serialNumber: 'TESTSN001',
          fields: { ID: '1', Return: '0', CMD: 'DATA', Name: '[redactado:9]' },
        },
        msg: 'zkteco: resultado de comando',
      });
    });

    it('nunca deja el cuerpo crudo en ninguna entrada del log', async () => {
      const { logger, command } = await setUp(['TESTSN001']);
      const body = 'ID=1&Return=0&CMD=DATA&Name=Ana Rojas&Passwd=1234';

      await command.execute({ ...resultInput, body, bodyLength: body.length });

      const logged = JSON.stringify(logger.entries);
      expect(logged).not.toContain('Ana Rojas');
      expect(logged).not.toContain('1234');
    });

    // Plan 006: una línea sin pares no es un resultado (antes se registraba con campos vacíos).
    it('un cuerpo sin pares no registra ningún resultado', async () => {
      const { logger, command } = await setUp(['TESTSN001']);

      await command.execute({ ...resultInput, body: 'OK', bodyLength: 2 });

      expect(logger.entries.map((entry) => entry.msg)).not.toContain(
        'zkteco: resultado de comando',
      );
    });

    it('otros tipos de contacto no registran resultado de comando aunque traigan cuerpo', async () => {
      const { logger, command } = await setUp(['TESTSN001']);

      await command.execute({ ...baseInput, body: 'ID=1&Return=0', bodyLength: 13 });

      expect(logger.entries.map((entry) => entry.msg)).toEqual([
        'zkteco: contacto del dispositivo',
      ]);
    });
  });

  it('rechaza un equipo registrado pero inactivo, con el mismo aviso', async () => {
    const { logger, command, deviceRepository } = await setUp([]);
    await deviceRepository.save(
      Device.restore('00000000-0000-4000-8000-0000000000bb' as DeviceId, {
        serialNumber: 'TESTSN001',
        name: 'Equipo inactivo',
        timeZone: 'America/Cancun',
        active: false,
        registeredAt: new Date('2026-01-15T12:00:00Z'),
        lastSeenAt: null,
        siteId: null,
        clockOffsetSeconds: null,
        clockOffsetMeasuredAt: null,
      }),
    );

    const result = await command.execute(baseInput);

    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
    expect(logger.entries).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'zkteco: dispositivo no autorizado' }),
    ]);
    expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toBeNull();
  });

  // Reparación de revisión (hallazgo M1, plan 005): el repositorio en memoria devuelve la misma
  // referencia guardada, así que un `save(device)` completo deja el mismo estado final que
  // `saveActivity(device)` y ningún test por estado lo distingue. Se espía el método llamado.
  it('guarda la actividad con saveActivity y nunca con save (hallazgo M1 de la revisión)', async () => {
    const { command, deviceRepository } = await setUp(['TESTSN001']);
    const saveActivitySpy = vi.spyOn(deviceRepository, 'saveActivity');
    const saveSpy = vi.spyOn(deviceRepository, 'save');

    await command.execute(baseInput);

    expect(saveActivitySpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('anota el último contacto y solo lo reescribe cuando pasó la resolución', async () => {
    const { command, clock, deviceRepository } = await setUp(['TESTSN001']);
    const t0 = new Date('2026-01-15T12:00:00Z');
    clock.set(t0);

    await command.execute(baseInput);
    expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(t0);

    clock.set(new Date(t0.getTime() + 10_000));
    await command.execute(baseInput);
    expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(t0);

    const later = new Date(t0.getTime() + 60_000);
    clock.set(later);
    await command.execute(baseInput);
    expect((await deviceRepository.findBySerialNumber('TESTSN001'))?.lastSeenAt).toEqual(later);
  });
});
