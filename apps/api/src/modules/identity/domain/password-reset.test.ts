import { describe, expect, it } from 'vitest';

import {
  PASSWORD_RESET_COMPLETED,
  PASSWORD_RESET_REQUESTED,
  PasswordReset,
  type PasswordResetId,
} from './password-reset';
import type { UserId } from './user';

const NOW = new Date('2026-01-15T12:00:00Z');
const TTL_MS = 3_600_000;
const USER = 'user-ana' as UserId;
const STAFF = 'user-rrhh' as UserId;
const HASH = 'b'.repeat(64);

function issue(requestedBy: UserId | null = null): PasswordReset {
  return PasswordReset.issue({
    id: 'reset-1' as PasswordResetId,
    userId: USER,
    tokenHash: HASH,
    requestedBy,
    ttlMs: TTL_MS,
    now: NOW,
  });
}

describe('PasswordReset.issue', () => {
  it('nace pendiente, vence a now + ttl y registra PASSWORD_RESET_REQUESTED sin el hash', () => {
    const reset = issue();

    expect(reset.snapshot).toMatchObject({
      userId: USER,
      requestedBy: null,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL_MS),
      usedAt: null,
      revokedAt: null,
    });
    expect(reset.isPendingAt(NOW)).toBe(true);
    const events = reset.pullEvents();
    expect(events.map((event) => event.name)).toEqual([PASSWORD_RESET_REQUESTED]);
    expect(events[0]?.payload).toEqual({
      passwordResetId: 'reset-1',
      userId: USER,
      requestedBy: null,
    });
    expect(JSON.stringify(events[0]?.payload)).not.toContain(HASH);
  });

  it('forzado por personal: requestedBy guarda el id y viaja en el evento', () => {
    const reset = issue(STAFF);

    expect(reset.snapshot.requestedBy).toBe(STAFF);
    expect(reset.pullEvents()[0]?.payload).toMatchObject({ requestedBy: STAFF });
  });
});

describe('PasswordReset.isPendingAt', () => {
  it('deja de estar pendiente exactamente al llegar a expiresAt', () => {
    const reset = issue();

    expect(reset.isPendingAt(new Date(NOW.getTime() + TTL_MS - 1))).toBe(true);
    expect(reset.isPendingAt(new Date(NOW.getTime() + TTL_MS))).toBe(false);
  });
});

describe('PasswordReset.use', () => {
  it('pendiente: queda usado y registra PASSWORD_RESET_COMPLETED', () => {
    const reset = issue();
    reset.pullEvents();

    const result = reset.use(NOW);

    expect(result.ok).toBe(true);
    expect(reset.snapshot.usedAt).toEqual(NOW);
    expect(reset.isPendingAt(NOW)).toBe(false);
    const events = reset.pullEvents();
    expect(events.map((event) => event.name)).toEqual([PASSWORD_RESET_COMPLETED]);
    expect(events[0]?.payload).toEqual({ passwordResetId: 'reset-1', userId: USER });
  });

  it('un segundo uso: PASSWORD_RESET_NOT_VALID y sin evento', () => {
    const reset = issue();
    reset.use(NOW);
    reset.pullEvents();

    const result = reset.use(NOW);

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(reset.pullEvents()).toEqual([]);
  });

  it('expirado: PASSWORD_RESET_NOT_VALID y no queda usado', () => {
    const reset = issue();

    const result = reset.use(new Date(NOW.getTime() + TTL_MS));

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(reset.snapshot.usedAt).toBeNull();
  });

  it('reemplazado: PASSWORD_RESET_NOT_VALID', () => {
    const reset = issue();
    reset.supersede(NOW);

    const result = reset.use(NOW);

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
  });
});

describe('PasswordReset.supersede', () => {
  it('pendiente: marca revokedAt y deja de estar pendiente', () => {
    const reset = issue();

    reset.supersede(NOW);

    expect(reset.snapshot.revokedAt).toEqual(NOW);
    expect(reset.isPendingAt(NOW)).toBe(false);
  });

  it('es no-op si ya no está pendiente: conserva la marca original', () => {
    const reset = issue();
    reset.supersede(NOW);

    reset.supersede(new Date(NOW.getTime() + 1000));

    expect(reset.snapshot.revokedAt).toEqual(NOW);
  });

  it('es no-op sobre uno ya usado', () => {
    const reset = issue();
    reset.use(NOW);

    reset.supersede(NOW);

    expect(reset.snapshot.revokedAt).toBeNull();
  });

  it('es no-op sobre uno expirado', () => {
    const reset = issue();

    reset.supersede(new Date(NOW.getTime() + TTL_MS));

    expect(reset.snapshot.revokedAt).toBeNull();
  });
});

describe('PasswordReset.restore', () => {
  it('rehidrata sin emitir eventos', () => {
    const original = issue();
    const restored = PasswordReset.restore('reset-1' as PasswordResetId, original.snapshot);

    expect(restored.pullEvents()).toEqual([]);
    expect(restored.isPendingAt(NOW)).toBe(true);
  });
});
