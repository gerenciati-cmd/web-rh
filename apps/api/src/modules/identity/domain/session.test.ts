import { describe, expect, it } from 'vitest';

import { SESSION_REVOKED, SESSION_STARTED, Session, type SessionId } from './session';
import type { UserId } from './user';

const now = new Date('2026-01-15T12:00:00Z');
const userId = 'user-1' as UserId;

const WEB_LIFETIME = { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 };
const MOBILE_LIFETIME = { absoluteMs: 30 * 86_400_000, idleMs: null };

function start(overrides: Partial<Parameters<typeof Session.start>[0]> = {}) {
  return Session.start({
    id: 'session-1' as SessionId,
    userId,
    tokenHash: 'hash-abc',
    client: 'WEB',
    lifetime: WEB_LIFETIME,
    now,
    ip: '10.0.0.1',
    userAgent: 'vitest',
    ...overrides,
  });
}

describe('Session', () => {
  it('start fija expiresAt = now + absoluteMs y lastSeenAt = createdAt = now', () => {
    const session = start();

    expect(session.snapshot.createdAt).toEqual(now);
    expect(session.snapshot.lastSeenAt).toEqual(now);
    expect(session.snapshot.expiresAt).toEqual(new Date(now.getTime() + WEB_LIFETIME.absoluteMs));
  });

  it('start registra SESSION_STARTED', () => {
    const session = start();

    expect(session.pullEvents().map((e) => e.name)).toEqual([SESSION_STARTED]);
  });

  describe('isActiveAt', () => {
    it('es true justo después de crearse', () => {
      const session = start();
      expect(session.isActiveAt(now)).toBe(true);
    });

    it('es false una vez revocada', () => {
      const session = start();
      session.revoke(now);
      expect(session.isActiveAt(now)).toBe(false);
    });

    it('es false cuando ya pasó expiresAt (vencimiento absoluto)', () => {
      const session = start();
      const afterAbsolute = new Date(now.getTime() + WEB_LIFETIME.absoluteMs);
      expect(session.isActiveAt(afterAbsolute)).toBe(false);
    });

    it('es false cuando pasó el tiempo de inactividad (web, idleMs no nulo)', () => {
      const session = start();
      const idleTooLong = new Date(now.getTime() + WEB_LIFETIME.idleMs + 1);
      expect(session.isActiveAt(idleTooLong)).toBe(false);
    });

    it('ignora la inactividad cuando idleMs es null (mobile), mientras no venza lo absoluto', () => {
      const session = start({ lifetime: MOBILE_LIFETIME, client: 'MOBILE' });
      // Mucho más que cualquier umbral de inactividad razonable, pero antes de lo absoluto.
      const farButBeforeAbsolute = new Date(now.getTime() + 20 * 86_400_000);
      expect(session.isActiveAt(farButBeforeAbsolute)).toBe(true);
    });
  });

  describe('needsTouch', () => {
    it('es false justo después de crearse', () => {
      const session = start();
      expect(session.needsTouch(now)).toBe(false);
    });

    it('es false justo antes del intervalo de touch (60s)', () => {
      const session = start();
      expect(session.needsTouch(new Date(now.getTime() + 59_999))).toBe(false);
    });

    it('es true al llegar al intervalo de touch (60s)', () => {
      const session = start();
      expect(session.needsTouch(new Date(now.getTime() + 60_000))).toBe(true);
    });
  });

  it('touch actualiza lastSeenAt sin tocar el resto', () => {
    const session = start();
    const later = new Date(now.getTime() + 60_000);

    session.touch(later);

    expect(session.snapshot.lastSeenAt).toEqual(later);
    expect(session.snapshot.createdAt).toEqual(now);
    expect(session.snapshot.expiresAt).toEqual(new Date(now.getTime() + WEB_LIFETIME.absoluteMs));
  });

  describe('revoke', () => {
    it('fija revokedAt y registra SESSION_REVOKED', () => {
      const session = start();
      session.pullEvents();

      session.revoke(now);

      expect(session.snapshot.revokedAt).toEqual(now);
      expect(session.pullEvents().map((e) => e.name)).toEqual([SESSION_REVOKED]);
    });

    it('es un no-op idempotente si ya estaba revocada (no registra un segundo evento)', () => {
      const session = start();
      session.revoke(now);
      session.pullEvents();

      const later = new Date(now.getTime() + 1000);
      session.revoke(later);

      expect(session.snapshot.revokedAt).toEqual(now);
      expect(session.pullEvents()).toEqual([]);
    });
  });
});
