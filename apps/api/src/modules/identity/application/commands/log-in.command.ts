import { Email, err, ok } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { InvalidCredentialsError, LoginTemporarilyBlockedError } from '../../domain/errors';
import { LoginThrottle, type LoginThrottlePolicy } from '../../domain/login-throttle';
import type { LoginThrottleRepository } from '../../domain/login-throttle.repository';
import {
  Session,
  type SessionClient,
  type SessionId,
  type SessionPolicy,
} from '../../domain/session';
import type { SessionRepository } from '../../domain/session.repository';
import type { UserRepository } from '../../domain/user.repository';
import type { PasswordHasher } from '../ports/password-hasher';
import type { SessionTokens } from '../ports/session-tokens';

export interface LogInCommandInput {
  email: string;
  password: string;
  client: 'web' | 'mobile';
  ip: string | null;
  userAgent: string | null;
}

export interface LogInOutput {
  user: { id: string; email: string };
  token: string;
  expiresAt: Date;
}

interface Deps {
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  loginThrottleRepository: LoginThrottleRepository;
  passwordHasher: PasswordHasher;
  sessionTokens: SessionTokens;
  sessionPolicy: SessionPolicy;
  loginThrottlePolicy: LoginThrottlePolicy;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

const MS_PER_SECOND = 1_000;

export class LogIn implements Command<LogInCommandInput, LogInOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(input: LogInCommandInput) {
    const {
      userRepository,
      sessionRepository,
      loginThrottleRepository,
      passwordHasher,
      sessionTokens,
      sessionPolicy,
      loginThrottlePolicy,
      idGenerator,
      clock,
      eventBus,
    } = this.deps;

    const now = clock.now();

    const email = Email.create(input.email);
    if (!email.ok) {
      await passwordHasher.simulateVerify(input.password);
      return err(new InvalidCredentialsError());
    }

    const throttles = await this.loadThrottles(loginThrottleRepository, email.value, input.ip, now);

    const blockedUntils = throttles
      .map((throttle) => throttle.blockedUntilAt(now))
      .filter((date): date is Date => date !== null);
    if (blockedUntils.length > 0) {
      const latest = new Date(Math.max(...blockedUntils.map((date) => date.getTime())));
      const retryAfterSeconds = Math.ceil((latest.getTime() - now.getTime()) / MS_PER_SECOND);
      return err(new LoginTemporarilyBlockedError(retryAfterSeconds));
    }

    const user = await userRepository.findByEmail(email.value);
    const valid = user
      ? (await passwordHasher.verify(input.password, user.snapshot.passwordHash)) && user.canSignIn
      : await passwordHasher.simulateVerify(input.password).then(() => false);

    // La condición repite `!valid` a propósito (cuando no hay user, `valid` ya es false):
    // así TypeScript estrecha `user` a no-nulo en el resto del método sin usar `!`.
    if (!user || !valid) {
      for (const throttle of throttles) throttle.registerFailure(now, loginThrottlePolicy);
      await Promise.all(throttles.map((throttle) => loginThrottleRepository.save(throttle)));
      return err(new InvalidCredentialsError());
    }

    const emailThrottle = throttles.find(
      (throttle) => throttle.id === LoginThrottle.keyForEmail(email.value),
    );
    if (emailThrottle) {
      emailThrottle.clear(now);
      await loginThrottleRepository.save(emailThrottle);
    }
    // El throttle de IP se deja como está a propósito: bloquear por IP protege contra
    // fuerza bruta distribuida por correo, no debe resetearse por un login ajeno exitoso.

    const { token, tokenHash } = sessionTokens.issue();
    const client: SessionClient = input.client === 'web' ? 'WEB' : 'MOBILE';

    // Sin transactionRunner: el throttle y la sesión son agregados independientes que
    // toleran una actualización perdida entre sí (no comparten invariante transaccional).
    const session = Session.start({
      id: idGenerator.next() as SessionId,
      userId: user.id,
      tokenHash,
      client,
      lifetime: sessionPolicy[client],
      now,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    await sessionRepository.save(session);
    await eventBus.publish(session.pullEvents());

    return ok({
      user: { id: user.id, email: user.snapshot.email.value },
      token,
      expiresAt: session.snapshot.expiresAt,
    });
  }

  private async loadThrottles(
    repository: LoginThrottleRepository,
    email: Email,
    ip: string | null,
    now: Date,
  ): Promise<LoginThrottle[]> {
    const keys = [LoginThrottle.keyForEmail(email), ...(ip ? [LoginThrottle.keyForIp(ip)] : [])];
    return Promise.all(
      keys.map(async (key) => (await repository.find(key)) ?? LoginThrottle.fresh(key, now)),
    );
  }
}
