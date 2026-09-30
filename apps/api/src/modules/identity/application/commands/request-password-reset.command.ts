import { Email, ok } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import type { UserRepository } from '../../domain/user.repository';
import type { PasswordResetIssuer } from '../password-reset-issuer';

export interface RequestPasswordResetInput {
  email: string;
}

interface Deps {
  userRepository: UserRepository;
  passwordResetIssuer: PasswordResetIssuer;
}

/**
 * "Olvidé mi contraseña". Siempre responde éxito: nunca revela si la cuenta existe (README
 * decisión 25). Correo inválido, desconocido o de usuario deshabilitado no hacen nada.
 */
export class RequestPasswordReset implements Command<RequestPasswordResetInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: RequestPasswordResetInput) {
    const { userRepository, passwordResetIssuer } = this.deps;

    const email = Email.create(input.email);
    if (!email.ok) return ok(undefined);
    const user = await userRepository.findByEmail(email.value);
    if (!user?.canSignIn) return ok(undefined);

    await passwordResetIssuer.issue({ user, requestedBy: null, respectCooldown: true });
    return ok(undefined);
  }
}
