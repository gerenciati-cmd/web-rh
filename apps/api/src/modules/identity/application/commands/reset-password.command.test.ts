import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { LoginThrottle, type LoginThrottlePolicy } from '../../domain/login-throttle';
import {
  PASSWORD_RESET_COMPLETED,
  PasswordReset,
  type PasswordResetId,
} from '../../domain/password-reset';
import { Session, type SessionId } from '../../domain/session';
import { USER_PASSWORD_CHANGED, User, type UserId } from '../../domain/user';
import { CryptoPasswordResetTokens } from '../../infrastructure/crypto-password-reset-tokens';
import { FakePasswordHasher } from '../../infrastructure/in-memory/fake-password-hasher';
import { InMemoryLoginThrottleRepository } from '../../infrastructure/in-memory/in-memory-login-throttle.repository';
import { InMemoryPasswordResetRepository } from '../../infrastructure/in-memory/in-memory-password-reset.repository';
import { InMemorySessionRepository } from '../../infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';

import { ResetPassword } from './reset-password.command';

/** Como el runner real: si el trabajo lanza, la transacción se revierte y el error se propaga. */
class RollbackSpyTransactionRunner implements TransactionRunner {
  rolledBack = 0;

  async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.rolledBack += 1;
      throw error;
    }
  }
}

/** Simula que otra operación cierra el restablecimiento justo después de que se leyó. */
class RacingPasswordResetRepository extends InMemoryPasswordResetRepository {
  constructor(private readonly now: () => Date) {
    super();
  }

  override async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const read = await super.findByTokenHash(tokenHash);
    if (read) this.resets.get(read.id)?.supersede(this.now());
    return read;
  }
}

/** Simula la baja del colaborador confirmada entre la lectura del token y el commit. */
class DisablingUserRepository extends InMemoryUserRepository {
  disableOnLock = false;
  locks = 0;

  constructor(private readonly now: () => Date) {
    super();
  }

  override async lock(id: UserId): Promise<boolean> {
    this.locks += 1;
    if (this.disableOnLock) this.users.get(id)?.disable(this.now());
    return super.lock(id);
  }
}

class FailingSessionRepository extends InMemorySessionRepository {
  override revokeAllForUser(): Promise<number> {
    return Promise.reject(new Error('BD caída'));
  }
}

const PASSWORD = 'contraseña-larga-y-valida';
const OLD_PASSWORD = 'contraseña-anterior-valida';
const TTL_MS = 3_600_000;
const POLICY: LoginThrottlePolicy = { maxFailures: 5, windowMs: 900_000, blockMs: 900_000 };
const SESSION_LIFETIME = { absoluteMs: 86_400_000, idleMs: null };

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('ResetPassword', () => {
  let users: DisablingUserRepository;
  let resets: InMemoryPasswordResetRepository;
  let sessions: InMemorySessionRepository;
  let throttles: InMemoryLoginThrottleRepository;
  let runner: RollbackSpyTransactionRunner;
  let eventBus: RecordingEventBus;
  let clock: FixedClock;
  let tokens: CryptoPasswordResetTokens;
  let ids: SequentialIdGenerator;
  let reset: ResetPassword;

  function build(resetRepository: InMemoryPasswordResetRepository): ResetPassword {
    return new ResetPassword({
      passwordResetRepository: resetRepository,
      passwordResetTokens: tokens,
      userRepository: users,
      sessionRepository: sessions,
      loginThrottleRepository: throttles,
      passwordHasher: new FakePasswordHasher(),
      transactionRunner: runner,
      clock,
      eventBus,
    });
  }

  beforeEach(() => {
    clock = new FixedClock();
    users = new DisablingUserRepository(() => clock.now());
    resets = new InMemoryPasswordResetRepository();
    sessions = new InMemorySessionRepository();
    throttles = new InMemoryLoginThrottleRepository();
    runner = new RollbackSpyTransactionRunner();
    eventBus = new RecordingEventBus();
    tokens = new CryptoPasswordResetTokens();
    ids = new SequentialIdGenerator();
    reset = build(resets);
    const ana = User.register({
      id: 'user-ana' as UserId,
      email: mustEmail('ana@aps.cl'),
      passwordHash: `fake:${OLD_PASSWORD}`,
      now: clock.now(),
    });
    ana.pullEvents();
    users.users.set(ana.id, ana);
  });

  /** Guarda un restablecimiento vigente y devuelve su token en claro. */
  function seedReset(
    repository: InMemoryPasswordResetRepository = resets,
    userId = 'user-ana',
  ): { token: string; aggregate: PasswordReset } {
    const { token, tokenHash } = tokens.issue();
    const aggregate = PasswordReset.issue({
      id: ids.next() as PasswordResetId,
      userId: userId as UserId,
      tokenHash,
      requestedBy: null,
      ttlMs: TTL_MS,
      now: clock.now(),
    });
    aggregate.pullEvents();
    repository.resets.set(aggregate.id, aggregate);
    return { token, aggregate };
  }

  function seedSession(userId = 'user-ana'): Session {
    const session = Session.start({
      id: ids.next() as SessionId,
      userId: userId as UserId,
      tokenHash: `hash-${String(sessions.sessions.size)}`,
      client: 'WEB',
      lifetime: SESSION_LIFETIME,
      now: clock.now(),
      ip: null,
      userAgent: null,
    });
    session.pullEvents();
    sessions.sessions.set(session.id, session);
    return session;
  }

  const storedHash = () => users.users.get('user-ana')?.snapshot.passwordHash;

  it('camino feliz: cambia el hash (nunca en claro), usa el restablecimiento y publica los eventos', async () => {
    const { token, aggregate } = seedReset();

    const result = await reset.execute({ token, password: PASSWORD });

    expect(result.ok).toBe(true);
    expect(storedHash()).toBe(`fake:${PASSWORD}`);
    expect(resets.resets.get(aggregate.id)?.snapshot.usedAt).toEqual(clock.now());
    expect(eventBus.names()).toEqual([USER_PASSWORD_CHANGED, PASSWORD_RESET_COMPLETED]);
  });

  it('no abre ninguna sesión', async () => {
    const { token } = seedReset();

    await reset.execute({ token, password: PASSWORD });

    expect(sessions.sessions.size).toBe(0);
  });

  it('cierra todas las sesiones abiertas del usuario y no toca las de otros', async () => {
    const { token } = seedReset();
    const first = seedSession();
    const second = seedSession();
    const foreign = seedSession('user-otro');

    await reset.execute({ token, password: PASSWORD });

    expect(sessions.sessions.get(first.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(sessions.sessions.get(second.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(sessions.sessions.get(foreign.id)?.snapshot.revokedAt).toBeNull();
  });

  it('levanta el bloqueo de login del correo', async () => {
    const { token } = seedReset();
    const key = LoginThrottle.keyForEmail(mustEmail('ana@aps.cl'));
    const blocked = LoginThrottle.fresh(key, clock.now());
    for (let i = 0; i < POLICY.maxFailures; i++) blocked.registerAttempt(clock.now(), POLICY);
    throttles.throttles.set(key, blocked);
    expect(blocked.blockedUntilAt(clock.now())).not.toBeNull();

    await reset.execute({ token, password: PASSWORD });

    const after = throttles.throttles.get(key);
    expect(after?.blockedUntilAt(clock.now())).toBeNull();
    expect(after?.snapshot.failures).toBe(0);
  });

  it('no toca el throttle de la IP', async () => {
    const { token } = seedReset();
    const ipKey = LoginThrottle.keyForIp('203.0.113.7');
    const ipThrottle = LoginThrottle.fresh(ipKey, clock.now());
    for (let i = 0; i < POLICY.maxFailures; i++) ipThrottle.registerAttempt(clock.now(), POLICY);
    throttles.throttles.set(ipKey, ipThrottle);

    await reset.execute({ token, password: PASSWORD });

    expect(throttles.throttles.get(ipKey)?.snapshot.failures).toBe(POLICY.maxFailures);
    expect(throttles.throttles.get(ipKey)?.blockedUntilAt(clock.now())).not.toBeNull();
  });

  it('reemplaza los demás restablecimientos pendientes del usuario', async () => {
    const { token } = seedReset();
    const other = seedReset();

    await reset.execute({ token, password: PASSWORD });

    expect(resets.resets.get(other.aggregate.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(resets.resets.get(other.aggregate.id)?.snapshot.usedAt).toBeNull();
  });

  it('bloquea la fila del usuario antes de escribir', async () => {
    const { token } = seedReset();

    await reset.execute({ token, password: PASSWORD });

    expect(users.locks).toBe(1);
  });

  it('contraseña débil: WEAK_PASSWORD, sin consumir el restablecimiento ni tocar nada', async () => {
    const { token, aggregate } = seedReset();
    const session = seedSession();

    const result = await reset.execute({ token, password: 'corta' });

    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
    expect(storedHash()).toBe(`fake:${OLD_PASSWORD}`);
    expect(resets.resets.get(aggregate.id)?.isPendingAt(clock.now())).toBe(true);
    expect(sessions.sessions.get(session.id)?.snapshot.revokedAt).toBeNull();
    expect(eventBus.published).toEqual([]);
  });

  it('contraseña débil con token inválido: gana la política (WEAK_PASSWORD)', async () => {
    const result = await reset.execute({ token: 'token-inventado', password: 'corta' });

    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
  });

  it('token desconocido: PASSWORD_RESET_NOT_VALID', async () => {
    const result = await reset.execute({ token: 'token-inventado', password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(storedHash()).toBe(`fake:${OLD_PASSWORD}`);
  });

  it('segundo uso del mismo token: PASSWORD_RESET_NOT_VALID y la contraseña no vuelve a cambiar', async () => {
    const { token } = seedReset();
    await reset.execute({ token, password: PASSWORD });

    const second = await reset.execute({ token, password: 'otra-contraseña-larga-xx' });

    expect(!second.ok && second.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(storedHash()).toBe(`fake:${PASSWORD}`);
  });

  it('token expirado: PASSWORD_RESET_NOT_VALID', async () => {
    const { token } = seedReset();
    clock.set(new Date(clock.now().getTime() + TTL_MS));

    const result = await reset.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(storedHash()).toBe(`fake:${OLD_PASSWORD}`);
  });

  it('token reemplazado: PASSWORD_RESET_NOT_VALID', async () => {
    const { token, aggregate } = seedReset();
    aggregate.supersede(clock.now());

    const result = await reset.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
  });

  it('desconocido, usado, reemplazado y expirado responden con el mismo cuerpo', async () => {
    const unknown = await reset.execute({ token: 'x', password: PASSWORD });
    const used = seedReset();
    await reset.execute({ token: used.token, password: PASSWORD });
    const usedAgain = await reset.execute({ token: used.token, password: PASSWORD });
    const superseded = seedReset();
    superseded.aggregate.supersede(clock.now());
    const supersededResult = await reset.execute({ token: superseded.token, password: PASSWORD });
    const expired = seedReset();
    clock.set(new Date(clock.now().getTime() + TTL_MS));
    const expiredResult = await reset.execute({ token: expired.token, password: PASSWORD });

    for (const result of [unknown, usedAgain, supersededResult, expiredResult]) {
      expect(!result.ok && { code: result.error.code, message: result.error.message }).toEqual({
        code: 'PASSWORD_RESET_NOT_VALID',
        message: 'El enlace para restablecer la contraseña no es válido o ya expiró',
      });
    }
  });

  it('usuario deshabilitado después de la solicitud: PASSWORD_RESET_NOT_VALID, sin cambiar nada', async () => {
    const { token, aggregate } = seedReset();
    users.users.get('user-ana')?.disable(clock.now());
    const session = seedSession();

    const result = await reset.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(storedHash()).toBe(`fake:${OLD_PASSWORD}`);
    expect(users.users.get('user-ana')?.snapshot.status).toBe('DISABLED');
    expect(resets.resets.get(aggregate.id)?.snapshot.usedAt).toBeNull();
    expect(sessions.sessions.get(session.id)?.snapshot.revokedAt).toBeNull();
    expect(eventBus.published).toEqual([]);
  });

  it('el usuario del restablecimiento ya no existe: PASSWORD_RESET_NOT_VALID', async () => {
    const { token } = seedReset(resets, 'user-fantasma');

    const result = await reset.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
  });

  it('la baja se confirma entre la lectura y el bloqueo (carrera): relee el usuario, revierte y no pisa DISABLED', async () => {
    const { token } = seedReset();
    users.disableOnLock = true;
    const session = seedSession();

    const result = await reset.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(runner.rolledBack).toBe(1);
    expect(users.users.get('user-ana')?.snapshot).toMatchObject({
      status: 'DISABLED',
      passwordHash: `fake:${OLD_PASSWORD}`,
    });
    expect(sessions.sessions.get(session.id)?.snapshot.revokedAt).toBeNull();
    expect(eventBus.published).toEqual([]);
  });

  it('el restablecimiento fue cerrado entre la lectura y el commit (carrera): PASSWORD_RESET_NOT_VALID, transacción revertida, sin eventos', async () => {
    const racing = new RacingPasswordResetRepository(() => clock.now());
    const loser = build(racing);
    const { token, aggregate } = seedReset(racing);
    const session = seedSession();

    const result = await loser.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('PASSWORD_RESET_NOT_VALID');
    expect(runner.rolledBack).toBe(1);
    expect(storedHash()).toBe(`fake:${OLD_PASSWORD}`);
    expect(sessions.sessions.get(session.id)?.snapshot.revokedAt).toBeNull();
    expect(eventBus.published).toEqual([]);
    expect(racing.resets.get(aggregate.id)?.snapshot).toMatchObject({
      usedAt: null,
      revokedAt: clock.now(),
    });
  });

  it('un error inesperado dentro de la transacción se propaga (no se disfraza de token inválido)', async () => {
    const { token } = seedReset();
    const failing = new ResetPassword({
      passwordResetRepository: resets,
      passwordResetTokens: tokens,
      userRepository: users,
      sessionRepository: new FailingSessionRepository(),
      loginThrottleRepository: throttles,
      passwordHasher: new FakePasswordHasher(),
      transactionRunner: runner,
      clock,
      eventBus,
    });

    await expect(failing.execute({ token, password: PASSWORD })).rejects.toThrow('BD caída');
    expect(eventBus.published).toEqual([]);
  });
});
