import { err, ok, type DomainError } from '@rrhh/domain';

import type { Command } from '@/shared/application/use-case';

import { EmployeeNotFoundError, UserDisabledError, UserNotFoundError } from '../../domain/errors';
import type { PasswordResetId } from '../../domain/password-reset';
import type { UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import type { PasswordResetIssuer } from '../password-reset-issuer';
import type { EmployeeDirectory } from '../ports/employee-directory';

export interface ForceEmployeePasswordResetInput {
  companyId: string;
  employeeId: string;
  requestedBy: string;
}

export interface PasswordResetIssued {
  id: PasswordResetId;
  email: string;
  expiresAt: string;
}

interface Deps {
  employeeDirectory: EmployeeDirectory;
  userRepository: UserRepository;
  passwordResetIssuer: PasswordResetIssuer;
}

/** RRHH fuerza el restablecimiento de un colaborador de su empresa; nunca fija la contraseña. */
export class ForceEmployeePasswordReset implements Command<
  ForceEmployeePasswordResetInput,
  PasswordResetIssued
> {
  constructor(private readonly deps: Deps) {}

  async execute(input: ForceEmployeePasswordResetInput) {
    const { employeeDirectory, userRepository, passwordResetIssuer } = this.deps;

    // Un colaborador de otra empresa responde igual que uno inexistente (ver InviteEmployee).
    const employee = await employeeDirectory.find(input.employeeId);
    if (employee?.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError());
    }
    const user = await userRepository.findByEmployeeId(employee.id);
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
