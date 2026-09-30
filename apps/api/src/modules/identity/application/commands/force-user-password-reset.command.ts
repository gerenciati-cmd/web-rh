import { err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import { UserDisabledError, UserNotFoundError } from '../../domain/errors';
import type { UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import type { PasswordResetIssuer } from '../password-reset-issuer';

import type { PasswordResetIssued } from './force-employee-password-reset.command';

export interface ForceUserPasswordResetInput {
  userId: string;
  requestedBy: string;
}

interface Deps {
  userRepository: UserRepository;
  passwordResetIssuer: PasswordResetIssuer;
}

/** El holding fuerza el restablecimiento de cualquier usuario, también externos sin colaborador. */
export class ForceUserPasswordReset implements Command<
  ForceUserPasswordResetInput,
  PasswordResetIssued
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: ForceUserPasswordResetInput) {
    const { userRepository, passwordResetIssuer } = this.deps;

    const user = await userRepository.findById(input.userId as UserId);
    if (!user) return err<DomainError>(new UserNotFoundError());
    if (!user.canSignIn) return err<DomainError>(new UserDisabledError());

    const reset = await passwordResetIssuer.issue({
      user,
      requestedBy: input.requestedBy as UserId,
      respectCooldown: false,
    });
    // Sin cooldown el emisor siempre devuelve el restablecimiento.
    if (!reset) throw new Error('El emisor no devolvió el restablecimiento forzado');

    return ok({
      id: reset.id,
      email: user.snapshot.email.value,
      expiresAt: reset.snapshot.expiresAt.toISOString(),
    });
  }
}
