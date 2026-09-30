import type { JobQueue } from '@/shared/application/jobs';
import type { Clock, EventBus, IdGenerator, TransactionRunner } from '@/shared/application/ports';

import { PasswordReset, type PasswordResetId } from '../domain/password-reset';
import type { PasswordResetRepository } from '../domain/password-reset.repository';
import type { User, UserId } from '../domain/user';
import type { UserRepository } from '../domain/user.repository';

import {
  SEND_PASSWORD_RESET_EMAIL,
  type SendPasswordResetEmailData,
} from './jobs/send-password-reset-email.job';
import type { PasswordResetPolicy, PasswordResetTokens } from './ports/password-reset-tokens';

interface Deps {
  passwordResetRepository: PasswordResetRepository;
  userRepository: UserRepository;
  passwordResetTokens: PasswordResetTokens;
  passwordResetPolicy: PasswordResetPolicy;
  idGenerator: IdGenerator;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
  jobQueue: JobQueue;
}

export interface IssuePasswordResetInput {
  user: User;
  /** `null` = lo pidió el propio usuario; un id = lo forzó el personal. */
  requestedBy: UserId | null;
  respectCooldown: boolean;
}

/**
 * Emite un restablecimiento y encola el correo. Compartido por la solicitud pública y las dos
 * rutas forzadas. Bloquea la fila del usuario para que dos solicitudes concurrentes dejen un solo
 * restablecimiento pendiente.
 */
export class PasswordResetIssuer {
  constructor(private readonly deps: Deps) {}

  /** `null` si `respectCooldown` y ya hay uno pendiente demasiado reciente. */
  async issue(input: IssuePasswordResetInput): Promise<PasswordReset | null> {
    const {
      passwordResetRepository,
      userRepository,
      passwordResetTokens,
      passwordResetPolicy,
      idGenerator,
      transactionRunner,
      clock,
      eventBus,
      jobQueue,
    } = this.deps;
    const { user, requestedBy, respectCooldown } = input;

    const now = clock.now();
    const { token, tokenHash } = passwordResetTokens.issue();
    const reset = PasswordReset.issue({
      id: idGenerator.next() as PasswordResetId,
      userId: user.id,
      tokenHash,
      requestedBy,
      ttlMs: passwordResetPolicy.ttlMs,
      now,
    });

    const issued = await transactionRunner.run(async () => {
      await userRepository.lock(user.id);
      const pending = await passwordResetRepository.findPendingForUser(user.id, now);
      const cooldownStart = now.getTime() - passwordResetPolicy.cooldownMs;
      if (respectCooldown && pending.some((p) => p.snapshot.createdAt.getTime() > cooldownStart)) {
        return false;
      }
      for (const old of pending) {
        old.supersede(now);
        await passwordResetRepository.save(old);
      }
      await passwordResetRepository.save(reset);
      return true;
    });
    if (!issued) return null;

    await eventBus.publish(reset.pullEvents());

    const data: SendPasswordResetEmailData = {
      to: user.snapshot.email.value,
      link: `${passwordResetPolicy.appPublicUrl}/restablecer?token=${token}`,
      expiresAt: reset.snapshot.expiresAt.toISOString(),
      forcedByStaff: requestedBy !== null,
    };
    // `sensitive`: el enlace lleva el token en claro y no debe quedar en Valkey.
    await jobQueue.enqueue(SEND_PASSWORD_RESET_EMAIL, data, { sensitive: true });

    return reset;
  }
}
