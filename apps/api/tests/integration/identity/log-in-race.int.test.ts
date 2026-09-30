import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import { DisableTerminatedEmployee } from '@/modules/identity/application/commands/disable-terminated-employee.command';
import { LogIn } from '@/modules/identity/application/commands/log-in.command';
import { ResetPassword } from '@/modules/identity/application/commands/reset-password.command';
import type { LoginThrottlePolicies } from '@/modules/identity/domain/login-throttle';
import { PasswordReset, type PasswordResetId } from '@/modules/identity/domain/password-reset';
import type { SessionPolicy } from '@/modules/identity/domain/session';
import { User, type UserId } from '@/modules/identity/domain/user';
import { CryptoPasswordResetTokens } from '@/modules/identity/infrastructure/crypto-password-reset-tokens';
import { CryptoSessionTokens } from '@/modules/identity/infrastructure/crypto-session-tokens';
import { FakePasswordHasher } from '@/modules/identity/infrastructure/in-memory/fake-password-hasher';
import { PrismaInvitationRepository } from '@/modules/identity/infrastructure/prisma-invitation.repository';
import { PrismaLoginThrottleRepository } from '@/modules/identity/infrastructure/prisma-login-throttle.repository';
import { PrismaPasswordResetRepository } from '@/modules/identity/infrastructure/prisma-password-reset.repository';
import { PrismaSessionRepository } from '@/modules/identity/infrastructure/prisma-session.repository';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase([
  'identity.sessions',
  'identity.password_resets',
  'identity.invitations',
  'identity.login_throttles',
  'identity.users',
]);
const transactionRunner = new PrismaTransactionRunner({ database });
const users = new PrismaUserRepository({ database });
const sessions = new PrismaSessionRepository({ database });
const throttles = new PrismaLoginThrottleRepository({ database });
const resets = new PrismaPasswordResetRepository({ database });
const invitations = new PrismaInvitationRepository({ database });
const ids = new SequentialIdGenerator();
const clock = new FixedClock(new Date('2026-01-15T12:00:00Z'));

const OLD_PASSWORD = 'contraseña-anterior-valida';
const NEW_PASSWORD = 'contraseña-nueva-y-valida';
const EMPLOYEE_ID = '00000000-0000-4000-8000-0000000000e1';
const SESSION_POLICY: SessionPolicy = {
  WEB: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
  MOBILE: { absoluteMs: 30 * 86_400_000, idleMs: null },
};
const THROTTLE_POLICIES: LoginThrottlePolicies = {
  email: { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
  ip: { maxFailures: 5, windowMs: 15 * 60_000, blockMs: 15 * 60_000 },
};

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

function deferred(): Deferred {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Retiene el login justo después de verificar la contraseña (ya leyó el hash viejo). */
class GatedPasswordHasher extends FakePasswordHasher {
  readonly verified = deferred();
  readonly release = deferred();

  override async verify(plain: string, hash: string): Promise<boolean> {
    const result = await super.verify(plain, hash);
    this.verified.resolve();
    await this.release.promise;
    return result;
  }
}

/** Retiene el login con el lock del usuario ya tomado, antes de guardar la sesión. */
class HoldingLockUserRepository extends PrismaUserRepository {
  readonly locked = deferred();
  readonly release = deferred();

  override async lock(id: UserId): Promise<boolean> {
    const result = await super.lock(id);
    this.locked.resolve();
    await this.release.promise;
    return result;
  }
}

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

async function seedUser(): Promise<User> {
  const user = User.register({
    id: ids.next() as UserId,
    email: mustEmail('ana@aps.cl'),
    passwordHash: `fake:${OLD_PASSWORD}`,
    employeeId: EMPLOYEE_ID,
    now: clock.now(),
  });
  const saved = await users.save(user);
  if (!saved.ok) throw saved.error;
  return user;
}

function logInWith(passwordHasher: FakePasswordHasher, userRepository: PrismaUserRepository) {
  return new LogIn({
    userRepository,
    sessionRepository: sessions,
    loginThrottleRepository: throttles,
    passwordHasher,
    sessionTokens: new CryptoSessionTokens(),
    sessionPolicy: SESSION_POLICY,
    loginThrottlePolicies: THROTTLE_POLICIES,
    transactionRunner,
    idGenerator: ids,
    clock,
    eventBus: new RecordingEventBus(),
  });
}

const loginInput = {
  email: 'ana@aps.cl',
  password: OLD_PASSWORD,
  client: 'web' as const,
  ip: '10.0.0.1',
  userAgent: 'vitest',
};

/** Seed de un restablecimiento pendiente y el comando real que lo consume. */
async function prepareReset(user: User) {
  const tokens = new CryptoPasswordResetTokens();
  const { token, tokenHash } = tokens.issue();
  await resets.save(
    PasswordReset.issue({
      id: ids.next() as PasswordResetId,
      userId: user.id,
      tokenHash,
      requestedBy: null,
      ttlMs: 3_600_000,
      now: clock.now(),
    }),
  );
  const resetPassword = new ResetPassword({
    passwordResetRepository: resets,
    passwordResetTokens: tokens,
    userRepository: users,
    sessionRepository: sessions,
    loginThrottleRepository: throttles,
    passwordHasher: new FakePasswordHasher(),
    transactionRunner,
    clock,
    eventBus: new RecordingEventBus(),
  });
  return () => resetPassword.execute({ token, password: NEW_PASSWORD });
}

function disableTerminated() {
  return new DisableTerminatedEmployee({
    userRepository: users,
    sessionRepository: sessions,
    invitationRepository: invitations,
    transactionRunner,
    clock,
    eventBus: new RecordingEventBus(),
  }).execute({ employeeId: EMPLOYEE_ID });
}

async function activeSessionCount(): Promise<number> {
  return database.client.session.count({ where: { revokedAt: null } });
}

describe('LogIn en carrera con el cierre de todas las sesiones (plan 006, BD real)', () => {
  describe('la contraseña se verificó antes y el otro proceso confirma primero', () => {
    it('ResetPassword confirma durante la verificación: el login se rechaza y no deja sesión', async () => {
      const user = await seedUser();
      const reset = await prepareReset(user);
      const hasher = new GatedPasswordHasher();
      const login = logInWith(hasher, users).execute(loginInput);

      await hasher.verified.promise;
      const resetResult = await reset();
      hasher.release.resolve();
      const result = await login;

      expect(resetResult.ok).toBe(true);
      expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
      expect(await database.client.session.count()).toBe(0);
    });

    it('DisableTerminatedEmployee confirma durante la verificación: el login se rechaza y no deja sesión', async () => {
      await seedUser();
      const hasher = new GatedPasswordHasher();
      const login = logInWith(hasher, users).execute(loginInput);

      await hasher.verified.promise;
      await disableTerminated();
      hasher.release.resolve();
      const result = await login;

      expect(!result.ok && result.error.code).toBe('INVALID_CREDENTIALS');
      expect(await database.client.session.count()).toBe(0);
    });
  });

  describe('el login toma el lock del usuario primero', () => {
    it('ResetPassword espera al login y luego revoca la sesión que este guardó', async () => {
      const user = await seedUser();
      const reset = await prepareReset(user);
      const holding = new HoldingLockUserRepository({ database });
      const login = logInWith(new FakePasswordHasher(), holding).execute(loginInput);

      await holding.locked.promise;
      const resetting = reset();
      holding.release.resolve();
      const [result, resetResult] = await Promise.all([login, resetting]);

      expect(result.ok).toBe(true);
      expect(resetResult.ok).toBe(true);
      expect(await database.client.session.count()).toBe(1);
      expect(await activeSessionCount()).toBe(0);
    });

    it('DisableTerminatedEmployee espera al login y luego revoca la sesión que este guardó', async () => {
      await seedUser();
      const holding = new HoldingLockUserRepository({ database });
      const login = logInWith(new FakePasswordHasher(), holding).execute(loginInput);

      await holding.locked.promise;
      const disabling = disableTerminated();
      holding.release.resolve();
      const [result] = await Promise.all([login, disabling]);

      expect(result.ok).toBe(true);
      expect(await database.client.session.count()).toBe(1);
      expect(await activeSessionCount()).toBe(0);
    });
  });

  it('sin carrera: un login normal guarda una sesión activa', async () => {
    await seedUser();

    const result = await logInWith(new FakePasswordHasher(), users).execute(loginInput);

    expect(result.ok).toBe(true);
    expect(await activeSessionCount()).toBe(1);
  });
});
