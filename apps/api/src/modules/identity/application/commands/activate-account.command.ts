import { err, ok, type DomainError, type Result } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  EmailAlreadyRegisteredError,
  EmployeeAlreadyLinkedError,
  InvitationNotValidError,
} from '../../domain/errors';
import type { InvitationRepository } from '../../domain/invitation.repository';
import { checkPasswordPolicy } from '../../domain/password-policy';
import { RoleAssignment, type RoleAssignmentId } from '../../domain/role-assignment';
import type { RoleAssignmentRepository } from '../../domain/role-assignment.repository';
import { User, type UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import type { EmployeeDirectory } from '../ports/employee-directory';
import type { InvitationTokens } from '../ports/invitation-tokens';
import type { PasswordHasher } from '../ports/password-hasher';

export interface ActivateAccountInput {
  token: string;
  password: string;
}

interface Deps {
  invitationRepository: InvitationRepository;
  invitationTokens: InvitationTokens;
  userRepository: UserRepository;
  roleAssignmentRepository: RoleAssignmentRepository;
  employeeDirectory: EmployeeDirectory;
  passwordHasher: PasswordHasher;
  idGenerator: IdGenerator;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
}

/**
 * Crea el `User` a partir de una invitación vigente. No abre sesión: la persona inicia sesión
 * normalmente después. Con colaborador, vincula la cuenta y le concede el rol EMPLOYEE.
 */
export class ActivateAccount implements Command<ActivateAccountInput, void> {
  constructor(private readonly deps: Deps) {}

  async execute(input: ActivateAccountInput) {
    const {
      invitationRepository,
      invitationTokens,
      userRepository,
      roleAssignmentRepository,
      passwordHasher,
      idGenerator,
      transactionRunner,
      clock,
      eventBus,
    } = this.deps;

    const policy = checkPasswordPolicy(input.password);
    if (!policy.ok) return policy;

    const now = clock.now();
    const invitation = await invitationRepository.findByTokenHash(
      invitationTokens.hashOf(input.token),
    );
    if (!invitation?.isPendingAt(now)) return err<DomainError>(new InvitationNotValidError());
    const { email, employeeId } = invitation.snapshot;

    if (await userRepository.findByEmail(email)) {
      return err<DomainError>(new EmailAlreadyRegisteredError());
    }

    const linked = await this.resolveEmployeeCompany(employeeId);
    if (!linked.ok) return linked;
    const employeeCompanyId = linked.value;

    const passwordHash = await passwordHasher.hash(input.password);
    const user = User.register({
      id: idGenerator.next() as UserId,
      email,
      passwordHash,
      employeeId,
      now,
    });
    const accepted = invitation.accept(now);
    if (!accepted.ok) return accepted;
    const assignment =
      employeeCompanyId === null
        ? null
        : RoleAssignment.grantSelf({
            id: idGenerator.next() as RoleAssignmentId,
            userId: user.id,
            companyId: employeeCompanyId,
            now,
          });

    const saved = await transactionRunner.run(async () => {
      const result = await userRepository.save(user);
      if (!result.ok) {
        // Dos activaciones simultáneas del mismo token: la segunda choca con el correo ya creado.
        return err<DomainError>(
          result.error instanceof EmployeeAlreadyLinkedError
            ? result.error
            : new EmailAlreadyRegisteredError(),
        );
      }
      await invitationRepository.save(invitation);
      if (assignment) await roleAssignmentRepository.save(assignment);
      return ok(undefined);
    });
    if (!saved.ok) return saved;

    await eventBus.publish([
      ...user.pullEvents(),
      ...invitation.pullEvents(),
      ...(assignment?.pullEvents() ?? []),
    ]);
    return ok(undefined);
  }

  /** `null` = invitación externa. Entre invitar y activar el colaborador pudo ser desvinculado. */
  private async resolveEmployeeCompany(
    employeeId: string | null,
  ): Promise<Result<string | null, DomainError>> {
    if (employeeId === null) return ok(null);

    const employee = await this.deps.employeeDirectory.find(employeeId);
    if (!employee?.active) return err(new InvitationNotValidError());
    if (await this.deps.userRepository.findByEmployeeId(employeeId)) {
      return err(new EmployeeAlreadyLinkedError());
    }
    return ok(employee.companyId);
  }
}
