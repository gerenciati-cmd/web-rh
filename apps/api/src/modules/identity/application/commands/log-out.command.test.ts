import { beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { SESSION_REVOKED, Session, type SessionId } from '../../domain/session';
import type { UserId } from '../../domain/user';
import { InMemorySessionRepository } from '../../infrastructure/in-memory/in-memory-session.repository';

import { LogOut } from './log-out.command';

const now = new Date('2026-01-15T12:00:00Z');

describe('LogOut', () => {
  let sessionRepository: InMemorySessionRepository;
  let eventBus: RecordingEventBus;
  let logOut: LogOut;

  beforeEach(() => {
    sessionRepository = new InMemorySessionRepository();
    eventBus = new RecordingEventBus();
    logOut = new LogOut({ sessionRepository, clock: new FixedClock(now), eventBus });
  });

  it('revoca una sesión existente, la guarda y publica SESSION_REVOKED', async () => {
    const session = Session.start({
      id: 'session-1' as SessionId,
      userId: 'user-1' as UserId,
      tokenHash: 'hash-1',
      client: 'WEB',
      lifetime: { absoluteMs: 3_600_000, idleMs: null },
      now,
      ip: null,
      userAgent: null,
    });
    session.pullEvents();
    sessionRepository.sessions.set(session.id, session);

    const result = await logOut.execute({ sessionId: session.id });

    expect(result.ok).toBe(true);
    expect(sessionRepository.sessions.get(session.id)?.snapshot.revokedAt).toEqual(now);
    expect(eventBus.names()).toEqual([SESSION_REVOKED]);
  });

  it('es idempotente: un sessionId inexistente responde ok sin publicar eventos', async () => {
    const result = await logOut.execute({ sessionId: 'no-existe' });

    expect(result.ok).toBe(true);
    expect(eventBus.names()).toEqual([]);
  });
});
