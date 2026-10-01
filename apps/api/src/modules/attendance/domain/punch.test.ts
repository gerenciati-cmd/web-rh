import { describe, expect, it } from 'vitest';

import type { DeviceId } from './device';
import { Punch, type PunchId } from './punch';

const RECEIVED = new Date('2026-09-28T18:00:00Z');

function build(overrides: Partial<Parameters<typeof Punch.fromDevice>[0]> = {}) {
  return Punch.fromDevice({
    id: '00000000-0000-4000-8000-000000000010' as PunchId,
    deviceId: '00000000-0000-4000-8000-000000000001' as DeviceId,
    timeZone: 'America/Cancun',
    pin: '2',
    deviceTime: '2026-09-28 12:17:29',
    status: '0',
    verifyMode: '1',
    receivedAt: RECEIVED,
    ...overrides,
  });
}

describe('Punch.fromDevice', () => {
  it('conserva la hora local tal como llegó y calcula el instante UTC con la zona del equipo', () => {
    const result = build();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.deviceLocalTime).toBe('2026-09-28 12:17:29');
    expect(result.value.occurredAt.toISOString()).toBe('2026-09-28T17:17:29.000Z');
    expect(result.value.pin).toBe('2');
    expect(result.value.status).toBe('0');
    expect(result.value.verifyMode).toBe('1');
    expect(result.value.receivedAt).toEqual(RECEIVED);
  });

  it.each(['', 'a b', '1\t2', 'x'.repeat(33)])('rechaza el PIN %j', (pin) => {
    const result = build({ pin });
    expect(!result.ok && result.error.message).toBe('PIN de marcación inválido');
  });

  it('acepta un PIN de 32 caracteres', () => {
    expect(build({ pin: 'x'.repeat(32) }).ok).toBe(true);
  });

  it('rechaza status o verifyMode de más de 16 caracteres y acepta 16', () => {
    const longStatus = build({ status: 'x'.repeat(17) });
    const longMode = build({ verifyMode: 'x'.repeat(17) });
    expect(!longStatus.ok && longStatus.error.message).toBe(
      'Marcación con campos demasiado largos',
    );
    expect(!longMode.ok && longMode.error.message).toBe('Marcación con campos demasiado largos');
    expect(build({ status: 'x'.repeat(16), verifyMode: 'y'.repeat(16) }).ok).toBe(true);
  });

  it('propaga el error de una fecha imposible', () => {
    const result = build({ deviceTime: '2026-02-30 08:00:00' });
    expect(!result.ok && result.error.message).toBe('Fecha y hora del equipo inválida');
  });

  it('propaga el error de una zona horaria inválida', () => {
    const result = build({ timeZone: 'Mars/Olympus' });
    expect(!result.ok && result.error.message).toBe('Zona horaria inválida');
  });
});
