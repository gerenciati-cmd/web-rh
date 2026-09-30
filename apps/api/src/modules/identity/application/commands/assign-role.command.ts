import { err, ok, type DomainError, type Role } from '@rrhh/domain';

import type { Clock, EventBus, IdGenerator } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  AssignmentCompanyInactiveError,
  AssignmentCompanyNotFoundError,
  RoleAlreadyAssignedError,
  UserNotFoundError,
} from '../../domain/errors';
import { RoleAssignment, type RoleAssignmentId } from '../../domain/role-assignment';
import type { RoleAssignmentRepository } from '../../domain/role-assignment.repository';
import type { UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import type { CompanyDirectory } from '../ports/company-directory';

export interface AssignRoleInput {
  userId: string;
  role: Role;
  companyId: string | null;
  /** `null` = sembrado por el sistema (seed). */
  assignedBy: string | null;
}

interface Deps {
  userRepository: UserRepository;
  roleAssignmentRepository: RoleAssignmentRepository;
  companyDirectory: CompanyDirectory;
  idGenerator: IdGenerator;
  clock: Clock;
  eventBus: EventBus;
}

export class AssignRole implements Command<AssignRoleInput, { id: RoleAssignmentId }> {
  constructor(private readonly deps: Deps) {}

  async execute(input: AssignRoleInput) {
    const {
      userRepository,
      roleAssignmentRepository,
      companyDirectory,
      idGenerator,
      clock,
      eventBus,
    } = this.deps;

    const user = await userRepository.findById(input.userId as UserId);
    if (!user) return err<DomainError>(new UserNotFoundError());

    const assignment = RoleAssignment.assign({
      id: idGenerator.next() as RoleAssignmentId,
      userId: user.id,
      role: input.role,
      companyId: input.companyId,
      assignedBy: input.assignedBy as UserId | null,
      now: clock.now(),
    });
    if (!assignment.ok) return assignment;

    if (input.companyId !== null) {
      const company = await companyDirectory.find(input.companyId);
      if (!company) return err<DomainError>(new AssignmentCompanyNotFoundError(input.companyId));
      if (!company.active) {
        return err<DomainError>(new AssignmentCompanyInactiveError(input.companyId));
      }
    }

    const active = await roleAssignmentRepository.findActiveByUser(user.id);
    const duplicate = active.some(
      (other) => other.snapshot.role === input.role && other.snapshot.companyId === input.companyId,
    );
    if (duplicate) return err<DomainError>(new RoleAlreadyAssignedError());

    await roleAssignmentRepository.save(assignment.value);
    await eventBus.publish(assignment.value.pullEvents());
    return ok({ id: assignment.value.id });
  }
}
