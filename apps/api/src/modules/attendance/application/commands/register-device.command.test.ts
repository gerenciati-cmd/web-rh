import { describe, expect, it } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { DEVICE_REGISTERED } from '../../domain/device';
import {
  InMemoryAttendanceStore,
  InMemoryDeviceRepository,
} from '../../infrastructure/in-memory/in-memory-attendance.store';

import { RegisterDevice } from './register-device.command';

function setUp() {
  const deviceRepository = new InMemoryDeviceRepository(new InMemoryAttendanceStore());
  const eventBus = new RecordingEventBus();
  const command = new RegisterDevice({
    deviceRepository,
    idGenerator: new SequentialIdGenerator(),
    clock: new FixedClock(),
    eventBus,
  });
  return { command, deviceRepository, eventBus };
}

const input = { serialNumber: 'TESTSN001', name: 'Entrada principal', timeZone: 'America/Cancun' };

describe('RegisterDevice', () => {
  it('registra el equipo, lo persiste activo y publica el evento de alta', async () => {
    const { command, deviceRepository, eventBus } = setUp();

    const result = await command.execute(input);

    expect(result.ok).toBe(true);
    const id = result.ok ? result.value.id : '';
    const saved = await deviceRepository.findBySerialNumber('TESTSN001');
    expect(saved?.id).toBe(id);
    expect(saved?.active).toBe(true);
    expect(saved?.timeZone).toBe('America/Cancun');
    expect(eventBus.names()).toEqual([DEVICE_REGISTERED]);
  });

  it('busca duplicados con el serial recortado', async () => {
    const { command } = setUp();
    await command.execute(input);

    const result = await command.execute({ ...input, serialNumber: '  TESTSN001 ' });

    expect(!result.ok && result.error.code).toBe('DEVICE_ALREADY_REGISTERED');
  });

  it('rechaza un serial ya registrado con DEVICE_ALREADY_REGISTERED y no publica otro evento', async () => {
    const { command, eventBus } = setUp();
    await command.execute(input);

    const result = await command.execute({ ...input, name: 'Otro nombre' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_ALREADY_REGISTERED');
    expect(!result.ok && result.error.details).toEqual({ serialNumber: 'TESTSN001' });
    expect(eventBus.published).toHaveLength(1);
  });

  it('propaga el error de dominio de una zona horaria inválida y no guarda nada', async () => {
    const { command, deviceRepository, eventBus } = setUp();

    const result = await command.execute({ ...input, timeZone: 'Mars/Olympus' });

    expect(!result.ok && result.error.message).toBe('Zona horaria inválida');
    expect(await deviceRepository.findBySerialNumber('TESTSN001')).toBeNull();
    expect(eventBus.published).toHaveLength(0);
  });
});
