import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import { Session, type SessionId } from '../domain/session';
import { User, type UserId } from '../domain/user';
import { CryptoSessionTokens } from '../infrastructure/crypto-session-tokens';
import { InMemorySessionRepository } from '../infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserRepository } from '../infrastructure/in-memory/in-memory-user.repository';

import { SessionAuthenticator } from './session-authenticator';

const now = new Date('2026-01-15T12:00:00Z');
const USER_ID = 'user-1' as UserId;

describe('SessionAuthenticator', () => {
  let userRepository: InMemoryUserRepository;
  let sessionRepository: InMemorySessionRepository;
  let sessionTokens: CryptoSessionTokens;
  let clock: FixedClock;
  let authenticator: SessionAuthenticator;

  beforeEach(() => {
    userRepository = new InMemoryUserRepository();
    sessionRepository = new InMemorySessionRepository();
    sessionTokens = new CryptoSessionTokens();
    clock = new FixedClock(now);
    authenticator = new SessionAuthenticator({
      sessionRepository,
      userRepository,
      sessionTokens,
      clock,
    });

    const user = User.restore(USER_ID, {
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      status: 'ACTIVE',
    });
    userRepository.users.set(user.id, user);
  });

  function issueSession(overrides: Partial<Parameters<typeof Session.start>[0]> = {}): {
    session: Session;
    token: string;
  } {
    const { token, tokenHash } = sessionTokens.issue();
    const session = Session.start({
      id: 'session-1' as SessionId,
      userId: USER_ID,
      tokenHash,
      client: 'WEB',
      lifetime: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
      now,
      ip: null,
      userAgent: null,
      ...overrides,
    });
    sessionRepository.sessions.set(session.id, session);
    return { session, token };
  }

  it('token desconocido: resuelve null', async () => {
    const actor = await authenticator.authenticate('token-que-no-existe');
    expect(actor).toBeNull();
  });

  it('sesión revocada: resuelve null', async () => {
    const { session, token } = issueSession();
    session.revoke(now);
    sessionRepository.sessions.set(session.id, session);

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión vencida (expiresAt <= now): resuelve null', async () => {
    const { token } = issueSession({ now: new Date(now.getTime() - 13 * 3_600_000) });

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión de un usuario que ya no existe: resuelve null', async () => {
    const { token } = issueSession();
    userRepository.users.delete(USER_ID);

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión de un usuario DISABLED: resuelve null', async () => {
    const { token } = issueSession();
    userRepository.users.set(
      USER_ID,
      User.restore(USER_ID, {
        email: mustEmail('ana@aps.cl'),
        passwordHash: 'hash',
        status: 'DISABLED',
      }),
    );

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión activa y reciente: resuelve el actor y NO toca lastSeenAt (needsTouch=false)', async () => {
    const { session, token } = issueSession();
    const saveSpy = vi.spyOn(sessionRepository, 'save');

    const actor = await authenticator.authenticate(token);

    expect(actor).toEqual({ userId: USER_ID, sessionId: session.id });
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('sesión activa pero con lastSeenAt viejo: hace touch y guarda', async () => {
    const { session, token } = issueSession();
    // needsTouch es true a partir de 60s sin actividad.
    clock.set(new Date(now.getTime() + 61_000));
    const saveSpy = vi.spyOn(sessionRepository, 'save');

    const actor = await authenticator.authenticate(token);

    expect(actor).toEqual({ userId: USER_ID, sessionId: session.id });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(sessionRepository.sessions.get(session.id)?.snapshot.lastSeenAt).toEqual(clock.now());
  });
});

function mustEmail(raw: string) {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}
