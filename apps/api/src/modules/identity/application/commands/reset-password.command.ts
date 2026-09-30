import { err, ok, type DomainError } from '@rrhh/domain';

import type { Clock, EventBus, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { PasswordResetNotValidError } from '../../domain/errors';
import { LoginThrottle } from '../../domain/login-throttle';
import type { LoginThrottleRepository } from '../../domain/login-throttle.repository';
import { checkPasswordPolicy } from '../../domain/password-policy';
import type { PasswordResetRepository } from '../../domain/password-reset.repository';
import type { SessionRepository } from '../../domain/session.repository';
import type { UserRepository } from '../../domain/user.repository';
import type { PasswordHasher } from '../ports/password-hasher';
import type { PasswordResetTokens } from '../ports/password-reset-tokens';

export interface ResetPasswordInput {
  token: string;
  password: string;
}

interface Deps {
  passwordResetRepository: PasswordResetRepository;
  passwordResetTokens: PasswordResetTokens;
  userRepository: UserRepository;
  sessionRepository: SessionRepository;
  loginThrottleRepository: LoginThrottleRepository;
  passwordHasher: PasswordHasher;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
}

/** Señal interna para revertir la transacción cuando el restablecimiento ya no es aplicable. */
class PasswordResetLostError extends Error {}

/**
 * Fija la contraseña nueva con el token del correo. Cierra todas las sesiones y levanta el
 * bloqueo de login del correo. No abre sesión: la persona inicia sesión normalmente después.
 */
export class ResetPassword implements Command<ResetPasswordInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: ResetPasswordInput) {
    const {
      passwordResetRepository,
      passwordResetTokens,
      userRepository,
      sessionRepository,
      loginThrottleRepository,
      passwordHasher,
      transactionRunner,
      clock,
      eventBus,
    } = this.deps;

    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) return policy;

    const now = clock.now();
    const reset = await passwordResetRepository.findByTokenHash(
      passwordResetTokens.hashOf(input.token),
    );
    if (!reset?.isPendingAt(now)) return err<DomainError>(new PasswordResetNotValidError());

    const passwordHash = await passwordHasher.hash(input.password);

    const events = await transactionRunner
      .run(async () => {
        // El bloqueo serializa contra otra confirmación y contra la baja del colaborador: la
        // relectura evita pisar un DISABLED ya confirmado con el snapshot completo.
        await userRepository.lock(reset.snapshot.userId);
        const user = await userRepository.findById(reset.snapshot.userId);
        if (!user?.canSignIn) throw new PasswordResetLostError();

        const used = reset.use(now);
        if (!used.ok) throw new PasswordResetLostError();
        if (!(await passwordResetRepository.save(reset))) throw new PasswordResetLostError();

        for (const other of await passwordResetRepository.findPendingForUser(user.id, now)) {
          other.supersede(now);
          await passwordResetRepository.save(other);
        }

        user.changePassword(passwordHash, now);
        await userRepository.save(user);
        await sessionRepository.revokeAllForUser(user.id, now);

        // Solo el throttle del correo: el de IP lo comparte cualquiera detrás de esa IP.
        const throttle = await loginThrottleRepository.lock(
          LoginThrottle.keyForEmail(user.snapshot.email),
          now,
        );
        throttle.clear(now);
        await loginThrottleRepository.save(throttle);

        return [...user.pullEvents(), ...reset.pullEvents()];
      })
      .catch((error: unknown) => {
        if (error instanceof PasswordResetLostError) return null;
        throw error;
      });
    if (!events) return err<DomainError>(new PasswordResetNotValidError());

    await eventBus.publish(events);
    return ok(undefined);
  }
}
