import { describe, expect, it } from 'vitest';

import { RecordingLogger } from '@/shared/testing/fakes';

import {
  RecordDeviceContact,
  type RecordDeviceContactInput,
} from './record-device-contact.command';

describe('RecordDeviceContact', () => {
  const baseInput: RecordDeviceContactInput = {
    serialNumber: 'TESTSN001',
    kind: 'handshake',
    method: 'GET',
    path: '/iclock/cdata',
    query: { SN: 'TESTSN001' },
    bodyLength: 0,
  };

  it('rechaza un número de serie fuera de la lista permitida y no autoriza', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDeviceContact({ logger, allowedDeviceSerials: ['OTRO'] });

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

  it('rechaza cualquier equipo cuando la lista permitida está vacía', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDeviceContact({ logger, allowedDeviceSerials: [] });

    const result = await command.execute(baseInput);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('DEVICE_NOT_ALLOWED');
  });

  it('registra a nivel info un contacto que no es poll', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDeviceContact({ logger, allowedDeviceSerials: ['TESTSN001'] });

    const result = await command.execute(baseInput);

    expect(result.ok).toBe(true);
    expect(logger.entries).toEqual([
      { level: 'info', obj: baseInput, msg: 'zkteco: contacto del dispositivo' },
    ]);
  });

  it('registra a nivel debug un contacto de tipo poll', async () => {
    const logger = new RecordingLogger();
    const command = new RecordDeviceContact({ logger, allowedDeviceSerials: ['TESTSN001'] });
    const pollInput: RecordDeviceContactInput = {
      ...baseInput,
      kind: 'poll',
      path: '/iclock/getrequest',
    };

    const result = await command.execute(pollInput);

    expect(result.ok).toBe(true);
    expect(logger.entries).toEqual([
      { level: 'debug', obj: pollInput, msg: 'zkteco: contacto del dispositivo' },
    ]);
  });
});
