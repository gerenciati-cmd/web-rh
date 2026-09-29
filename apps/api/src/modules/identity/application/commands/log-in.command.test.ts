import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { LoginThrottle, type LoginThrottlePolicy } from '../../domain/login-throttle';
import type { SessionPolicy } from '../../domain/session';
import { User, type UserId } from '../../domain/user';
import { CryptoSessionTokens } from '../../infrastructure/crypto-session-tokens';
import { FakePasswordHasher } from '../../infrastructure/in-memory/fake-password-hasher';
import { InMemoryLoginThrottleRepository } from '../../infrastructure/in-memory/in-memory-login-throttle.repository';
import { InMemorySessionRepository } from '../../infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';

import { LogIn, type LogInCommandInput } from './log-in.command';

const now = new Date('2026-01-15T12:00:00Z');

const SESSION_POLICY: SessionPolicy = {
  WEB: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
  MOBILE: { absoluteMs: 30 * 86_400_000, idleMs: null },
};
const THROTTLE_POLICY: LoginThrottlePolicy = {
  maxFailures: 5,
  windowMs: 15 * 60_000,
  blockMs: 15 * 60_000,
};
const PASSWORD = 'contraseña-correcta';

function email(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('LogIn', () => {
  let userRepository: InMemoryUserRepository;
  let sessionRepository: InMemorySessionRepository;
  let throttleRepository: InMemoryLoginThrottleRepository;
  let hasher: FakePasswordHasher;
  let sessionTokens: CryptoSessionTokens;
  let eventBus: RecordingEventBus;
  let logIn: LogIn;

  beforeEach(() => {
    userRepository = new InMemoryUserRepository();
    sessionRepository = new InMemorySessionRepository();
    throttleRepository = new InMemoryLoginThrottleRepository();
    hasher = new FakePasswordHasher();
    sessionTokens = new CryptoSessionTokens();
    eventBus = new RecordingEventBus();
    logIn = new LogIn({
      userRepository,
      sessionRepository,
      loginThrottleRepository: throttleRepository,
      passwordHasher: hasher,
      sessionTokens,
      sessionPolicy: SESSION_POLICY,
      loginThrottlePolicy: THROTTLE_POLICY,
      idGenerator: new SequentialIdGenerator(),
      clock: new FixedClock(now),
      eventBus,
    });
  });

  function registerUser(rawEmail: string, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE'): void {
    const user = User.restore(`user-${rawEmail}` as UserId, {
      email: email(rawEmail),
      passwordHash: `fake:${PASSWORD}`,
      status,
    });
    userRepository.users.set(user.id, user);
  }

  const input: LogInCommandInput = {
    email: 'ana@aps.cl',
    password: PASSWORD,
    client: 'web',
    ip: '10.0.0.1',
    userAgent: 'vitest',
  };

  it('correo con formato inválido: simula la verificación y responde INVALID_CREDENTIALS sin tocar el throttle', async () => {
    const result = await logIn.execute({ ...input, email: 'no-es-email' });

    expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
    expect(hasher.simulateVerifyCalls).toBe(1);
    expect(throttleRepository.throttles.size).toBe(0);
  });

  it('bloqueado por el throttle de correo: no verifica la contraseña y responde 429 con retryAfterSeconds', async () => {
    const blockedUntil = new Date(now.getTime() + 10 * 60_000);
    const throttle = LoginThrottle.restore(LoginThrottle.keyForEmail(email(input.email)), {
      failures: THROTTLE_POLICY.maxFailures,
      windowStartedAt: now,
      blockedUntil,
    });
    throttleRepository.throttles.set(throttle.id, throttle);
    registerUser(input.email);
    const verifySpy = vi.spyOn(hasher, 'verify');

    const result = await logIn.execute(input);

    expect(!result.ok && result.error.code).toBe('LOGIN_TEMPORARILY_BLOCKED');
    expect(!result.ok && result.error.details?.retryAfterSeconds).toBe(600);
    expect(verifySpy).not.toHaveBeenCalled();
    expect(hasher.simulateVerifyCalls).toBe(0);
  });

  it('bloqueado por el throttle de la IP aunque el correo esté libre', async () => {
    const blockedUntil = new Date(now.getTime() + 5 * 60_000);
    const throttle = LoginThrottle.restore(LoginThrottle.keyForIp(input.ip!), {
      failures: THROTTLE_POLICY.maxFailures,
      windowStartedAt: now,
      blockedUntil,
    });
    throttleRepository.throttles.set(throttle.id, throttle);

    const result = await logIn.execute(input);

    expect(!result.ok && result.error.code).toBe('LOGIN_TEMPORARILY_BLOCKED');
    expect(!result.ok && result.error.details?.retryAfterSeconds).toBe(300);
  });

  it('usuario desconocido: simula la verificación, responde INVALID_CREDENTIALS y registra el fallo en ambos throttles', async () => {
    const result = await logIn.execute(input);

    expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
    expect(hasher.simulateVerifyCalls).toBe(1);
    const emailThrottle = throttleRepository.throttles.get(
      LoginThrottle.keyForEmail(email(input.email)),
    );
    expect(emailThrottle?.snapshot.failures).toBe(1);
    const ipThrottle = throttleRepository.throttles.get(LoginThrottle.keyForIp(input.ip!));
    expect(ipThrottle?.snapshot.failures).toBe(1);
  });

  it('contraseña incorrecta: verifica de verdad (no simula), responde INVALID_CREDENTIALS y registra el fallo', async () => {
    registerUser(input.email);

    const result = await logIn.execute({ ...input, password: 'otra-cosa' });

    expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
    expect(hasher.simulateVerifyCalls).toBe(0);
    const emailThrottle = throttleRepository.throttles.get(
      LoginThrottle.keyForEmail(email(input.email)),
    );
    expect(emailThrottle?.snapshot.failures).toBe(1);
  });

  it('usuario DISABLED con contraseña correcta: responde INVALID_CREDENTIALS (mismo error que una contraseña incorrecta) y no crea sesión', async () => {
    registerUser(input.email, 'DISABLED');

    const result = await logIn.execute(input);

    expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
    const emailThrottle = throttleRepository.throttles.get(
      LoginThrottle.keyForEmail(email(input.email)),
    );
    expect(emailThrottle?.snapshot.failures).toBe(1);
    expect(sessionRepository.sessions.size).toBe(0);
  });

  it('login exitoso: limpia el throttle del correo, deja intacto el de la IP, y crea la sesión', async () => {
    registerUser(input.email);
    const emailKey = LoginThrottle.keyForEmail(email(input.email));
    const ipKey = LoginThrottle.keyForIp(input.ip!);
    throttleRepository.throttles.set(
      emailKey,
      LoginThrottle.restore(emailKey, { failures: 3, windowStartedAt: now, blockedUntil: null }),
    );
    throttleRepository.throttles.set(
      ipKey,
      LoginThrottle.restore(ipKey, { failures: 2, windowStartedAt: now, blockedUntil: null }),
    );

    const result = await logIn.execute(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.user).toEqual({ id: `user-${input.email}`, email: input.email });
    expect(typeof result.value.token).toBe('string');
    expect(result.value.token.length).toBeGreaterThan(0);
    expect(result.value.expiresAt).toEqual(new Date(now.getTime() + SESSION_POLICY.WEB.absoluteMs));

    expect(throttleRepository.throttles.get(emailKey)?.snapshot.failures).toBe(0);
    expect(throttleRepository.throttles.get(ipKey)?.snapshot.failures).toBe(2); // se deja como está

    const [session] = [...sessionRepository.sessions.values()];
    expect(session?.snapshot.client).toBe('WEB');
    expect(session?.snapshot.userId).toBe(`user-${input.email}`);
    expect(session?.snapshot.tokenHash).toBe(sessionTokens.hashOf(result.value.token));
    expect(eventBus.names()).toEqual(['identity.session.started']);
  });

  it('client=mobile usa la política de sesión mobile (sin expiración por inactividad)', async () => {
    registerUser(input.email);

    const result = await logIn.execute({ ...input, client: 'mobile' });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [session] = [...sessionRepository.sessions.values()];
    expect(session?.snapshot.client).toBe('MOBILE');
    expect(session?.snapshot.idleTimeoutMs).toBeNull();
    expect(result.value.expiresAt).toEqual(
      new Date(now.getTime() + SESSION_POLICY.MOBILE.absoluteMs),
    );
  });
});
