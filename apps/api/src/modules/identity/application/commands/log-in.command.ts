import { Email, err, ok } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { InvalidCredentialsError, LoginTemporarilyBlockedError } from '../../domain/errors';
import {
  LoginThrottle,
  type LoginThrottlePolicies,
  type LoginThrottlePolicy,
} from '../../domain/login-throttle';
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
  loginThrottlePolicies: LoginThrottlePolicies;
  transactionRunner: TransactionRunner;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

const MS_PER_SECOND = 1_000;

/** Resultado de reservar un intento para una llave: o quedó reservado, o la llave ya estaba
 *  bloqueada de antes (en cuyo caso nada se registró). */
type ReservationOutcome = { reserved: true } | { reserved: false; blockedUntil: Date };

export class LogIn implements Command<LogInCommandInput, LogInOutput> {
  constructor(private readonly deps: Deps) {}

  async execute(input: LogInCommandInput) {
    const {
      userRepository,
      sessionRepository,
      passwordHasher,
      sessionTokens,
      sessionPolicy,
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

    const emailKey = LoginThrottle.keyForEmail(email.value);
    const ipKey = input.ip ? LoginThrottle.keyForIp(input.ip) : null;
    const keys = ipKey ? [emailKey, ipKey] : [emailKey];

    // Cada llave reserva su intento ANTES de verificar la contraseña, bajo un row lock (H3):
    // así una ráfaga concurrente no puede leer el mismo contador y perder incrementos, y el
    // límite frena la ráfaga aunque nada haya llamado todavía a argon2.
    const blocked = await this.reserveOrBlock(keys, now);
    if (blocked) return err(blocked);

    const user = await userRepository.findByEmail(email.value);
    const valid = user
      ? (await passwordHasher.verify(input.password, user.snapshot.passwordHash)) && user.canSignIn
      : await passwordHasher.simulateVerify(input.password).then(() => false);

    // La condición repite `!valid` a propósito (cuando no hay user, `valid` ya es false):
    // así TypeScript estrecha `user` a no-nulo en el resto del método sin usar `!`.
    if (!user || !valid) {
      // El intento ya quedó contado en la reserva de arriba (H3): nada más que escribir.
      return err(new InvalidCredentialsError());
    }

    // Éxito: se limpia el throttle del correo entero, pero el de IP solo libera SU reserva de
    // esta petición (no se limpia entero) — un login ajeno correcto no debe resetear el cupo de
    // fuerza bruta de quien comparte la IP.
    await this.clear(emailKey, now);
    if (ipKey) await this.release(ipKey, now);

    const { token, tokenHash } = sessionTokens.issue();
    const client: SessionClient = input.client === 'web' ? 'WEB' : 'MOBILE';

    // El throttle usa transactionRunner porque el row lock (`FOR UPDATE`) solo tiene sentido
    // dentro de una transacción; la sesión sigue siendo un agregado independiente, sin
    // transacción compartida con el throttle (tolera una actualización perdida entre sí).
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

  /**
   * Reserva un intento por cada llave, en orden, y se detiene en la primera bloqueada (L3): no
   * reserva las llaves siguientes, así un correo bloqueado no consume ni por un instante el cupo
   * de una IP compartida. Deshace solo las reservas ya hechas y devuelve el error a propagar
   * (`null` si ninguna llave estaba bloqueada y quedaron todas reservadas).
   */
  private async reserveOrBlock(
    keys: string[],
    now: Date,
  ): Promise<LoginTemporarilyBlockedError | null> {
    const reserved: string[] = [];
    for (const key of keys) {
      const outcome = await this.reserveAttempt(key, now);
      if (outcome.reserved) {
        reserved.push(key);
        continue;
      }

      // El bloqueo pudo fijarlo esta reserva o una concurrente. Liberar la nuestra sigue siendo
      // correcto: `releaseAttempt` solo levanta el bloqueo si los fallos bajan del límite.
      for (const reservedKey of reserved) await this.release(reservedKey, now);
      const retryAfterSeconds = Math.ceil(
        (outcome.blockedUntil.getTime() - now.getTime()) / MS_PER_SECOND,
      );
      return new LoginTemporarilyBlockedError(retryAfterSeconds);
    }
    return null;
  }

  private async reserveAttempt(key: string, now: Date): Promise<ReservationOutcome> {
    const { transactionRunner, loginThrottleRepository } = this.deps;
    return transactionRunner.run(async () => {
      const throttle = await loginThrottleRepository.lock(key, now);
      const blockedUntil = throttle.blockedUntilAt(now);
      if (blockedUntil) return { reserved: false, blockedUntil };
      throttle.registerAttempt(now, this.policyFor(key));
      await loginThrottleRepository.save(throttle);
      return { reserved: true };
    });
  }

  private async release(key: string, now: Date): Promise<void> {
    const { transactionRunner, loginThrottleRepository } = this.deps;
    await transactionRunner.run(async () => {
      const throttle = await loginThrottleRepository.lock(key, now);
      throttle.releaseAttempt(this.policyFor(key));
      await loginThrottleRepository.save(throttle);
    });
  }

  private async clear(key: string, now: Date): Promise<void> {
    const { transactionRunner, loginThrottleRepository } = this.deps;
    await transactionRunner.run(async () => {
      const throttle = await loginThrottleRepository.lock(key, now);
      throttle.clear(now);
      await loginThrottleRepository.save(throttle);
    });
  }

  private policyFor(key: string): LoginThrottlePolicy {
    const { loginThrottlePolicies } = this.deps;
    return key.startsWith('ip:') ? loginThrottlePolicies.ip : loginThrottlePolicies.email;
  }
}
