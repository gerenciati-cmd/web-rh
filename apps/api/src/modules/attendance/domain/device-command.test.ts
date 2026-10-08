import { describe, expect, it } from 'vitest';

import type { DeviceId } from './device';
import { DeviceCommand, type DeviceCommandId } from './device-command';

const NOW = new Date('2026-10-02T12:00:00Z');
const deviceId = '00000000-0000-4000-8000-0000000000d1' as DeviceId;
const base = {
  id: '00000000-0000-4000-8000-0000000000c1' as DeviceCommandId,
  deviceId,
  number: 1,
  queuedBy: '00000000-0000-4000-8000-0000000000a1',
  now: NOW,
};

describe('DeviceCommand.queue', () => {
  it.each([
    'DATA UPDATE USERINFO PIN=GOMA850101AB1\tName=Ana Rojas',
    'DATA QUERY USERINFO PIN=1',
    'DATA DELETE USERINFO PIN=1',
  ])('encola el comando de la familia USERINFO %j', (command) => {
    const result = DeviceCommand.queue({ ...base, command });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('QUEUED');
    expect(result.value.command).toBe(command);
    expect(result.value.deviceId).toBe(deviceId);
    expect(result.value.queuedAt).toEqual(NOW);
    expect(result.value.sentAt).toBeNull();
    expect(result.value.queuedBy).toBe(base.queuedBy);
  });

  it.each([
    'CLEAR DATA',
    'REBOOT',
    'DATA UPDATE BIODATA Pin=1',
    'DATA UPDATE USERINFO',
    'data update userinfo PIN=1',
    ' DATA UPDATE USERINFO PIN=1',
    'C:x:DATA UPDATE USERINFO PIN=1',
    // Plan 006: el prefijo lo asigna el API; escrito a mano se rechaza.
    'C:12:DATA UPDATE USERINFO PIN=1',
    // Hallazgo H1 de la revisión: un salto de línea colaría un segundo comando.
    'DATA QUERY USERINFO PIN=1\nC:99:CLEAR DATA',
    'DATA QUERY USERINFO PIN=1\r\nCLEAR DATA',
    'DATA QUERY USERINFO PIN=1\u0000',
  ])('rechaza %j con INVALID_VALUE', (command) => {
    const result = DeviceCommand.queue({ ...base, command });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('rechaza el texto vacío y el que pasa de 500 caracteres', () => {
    const prefix = 'DATA UPDATE USERINFO ';
    const empty = DeviceCommand.queue({ ...base, command: '' });
    const exact = DeviceCommand.queue({
      ...base,
      command: prefix + 'x'.repeat(500 - prefix.length),
    });
    const long = DeviceCommand.queue({
      ...base,
      command: prefix + 'x'.repeat(501 - prefix.length),
    });

    expect(!empty.ok && empty.error.code).toBe('INVALID_VALUE');
    expect(exact.ok).toBe(true);
    expect(!long.ok && long.error.code).toBe('INVALID_VALUE');
  });

  // Plan 006: el número C:<n>: lo asigna el API; uno inválido no debe poder encolarse.
  it.each([0, -1, 1.5, Number.NaN])('rechaza el número %j con INVALID_VALUE', (number) => {
    const result = DeviceCommand.queue({ ...base, number, command: 'DATA QUERY USERINFO PIN=1' });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('acepta el número 1 y lo expone en wireText con el comando sin prefijo', () => {
    const result = DeviceCommand.queue({
      ...base,
      number: 7,
      command: 'DATA QUERY USERINFO PIN=1',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.number).toBe(7);
    expect(result.value.command).toBe('DATA QUERY USERINFO PIN=1');
    expect(result.value.wireText).toBe('C:7:DATA QUERY USERINFO PIN=1');
  });
});

describe('DeviceCommand.markSent', () => {
  function queued(): DeviceCommand {
    const result = DeviceCommand.queue({ ...base, command: 'DATA QUERY USERINFO PIN=1' });
    if (!result.ok) throw result.error;
    return result.value;
  }

  it('pasa a SENT y anota cuándo se entregó', () => {
    const command = queued();
    const sentAt = new Date('2026-10-02T12:00:10Z');

    command.markSent(sentAt);

    expect(command.status).toBe('SENT');
    expect(command.sentAt).toEqual(sentAt);
  });

  it('un comando ya enviado no cambia al marcarlo otra vez', () => {
    const command = queued();
    const first = new Date('2026-10-02T12:00:10Z');
    command.markSent(first);

    command.markSent(new Date('2026-10-02T12:05:00Z'));

    expect(command.sentAt).toEqual(first);
  });

  // Deviación 4 del plan 006: el guard pasó de "no SENT" a "solo desde QUEUED", así que un
  // comando ya cerrado no puede volver a SENT.
  it('un comando DONE no vuelve a SENT al marcarlo de nuevo', () => {
    const command = queued();
    const sentAt = new Date('2026-10-02T12:00:10Z');
    command.markSent(sentAt);
    command.complete('0', new Date('2026-10-02T12:00:20Z'));

    command.markSent(new Date('2026-10-02T12:05:00Z'));

    expect(command.status).toBe('DONE');
    expect(command.sentAt).toEqual(sentAt);
  });
});

describe('DeviceCommand.complete', () => {
  function sent(): DeviceCommand {
    const result = DeviceCommand.queue({ ...base, command: 'DATA QUERY USERINFO PIN=1' });
    if (!result.ok) throw result.error;
    result.value.markSent(new Date('2026-10-02T12:00:10Z'));
    return result.value;
  }

  it('Return=0 cierra DONE y anota el código y la hora', () => {
    const command = sent();
    const completedAt = new Date('2026-10-02T12:00:20Z');

    const changed = command.complete('0', completedAt);

    expect(changed).toBe(true);
    expect(command.status).toBe('DONE');
    expect(command.returnCode).toBe('0');
    expect(command.completedAt).toEqual(completedAt);
  });

  it('un Return distinto de 0 (incluso negativo) cierra FAILED', () => {
    const command = sent();

    const changed = command.complete('-1', new Date('2026-10-02T12:00:20Z'));

    expect(changed).toBe(true);
    expect(command.status).toBe('FAILED');
    expect(command.returnCode).toBe('-1');
  });

  it('un comando QUEUED (nunca entregado) no se puede completar', () => {
    const result = DeviceCommand.queue({ ...base, command: 'DATA QUERY USERINFO PIN=1' });
    if (!result.ok) throw result.error;

    const changed = result.value.complete('0', new Date('2026-10-02T12:00:20Z'));

    expect(changed).toBe(false);
    expect(result.value.status).toBe('QUEUED');
    expect(result.value.returnCode).toBeNull();
  });

  it('una respuesta repetida sobre un comando ya cerrado no cambia nada', () => {
    const command = sent();
    const firstCompletedAt = new Date('2026-10-02T12:00:20Z');
    command.complete('0', firstCompletedAt);

    const changed = command.complete('0', new Date('2026-10-02T12:05:00Z'));

    expect(changed).toBe(false);
    expect(command.completedAt).toEqual(firstCompletedAt);
  });

  it.each(['x', '', '1.5', ' 0'])(
    'un returnCode con forma inválida (%j) no cierra el comando',
    (returnCode) => {
      const command = sent();

      const changed = command.complete(returnCode, new Date('2026-10-02T12:00:20Z'));

      expect(changed).toBe(false);
      expect(command.status).toBe('SENT');
    },
  );
});
