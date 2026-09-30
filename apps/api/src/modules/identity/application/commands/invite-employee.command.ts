import { Email, err, ok, type DomainError } from '@rrhh/domain';

import type { JobQueue } from '@/shared/application/jobs';
import type { Clock, EventBus, IdGenerator, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import {
  EmailAlreadyRegisteredError,
  EmployeeAlreadyLinkedError,
  EmployeeInactiveError,
  EmployeeNotFoundError,
} from '../../domain/errors';
import { Invitation, type InvitationId } from '../../domain/invitation';
import type { InvitationRepository } from '../../domain/invitation.repository';
import type { UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import {
  SEND_INVITATION_EMAIL,
  type SendInvitationEmailData,
} from '../jobs/send-invitation-email.job';
import type { EmployeeDirectory } from '../ports/employee-directory';
import type { InvitationPolicy, InvitationTokens } from '../ports/invitation-tokens';

export interface InviteEmployeeInput {
  companyId: string;
  employeeId: string;
  /** Si falta, se usa el correo de la ficha. */
  email?: string | undefined;
  invitedBy: string;
}

export interface InvitationIssued {
  id: InvitationId;
  email: string;
  expiresAt: string;
}

interface Deps {
  employeeDirectory: EmployeeDirectory;
  userRepository: UserRepository;
  invitationRepository: InvitationRepository;
  invitationTokens: InvitationTokens;
  invitationPolicy: InvitationPolicy;
  idGenerator: IdGenerator;
  transactionRunner: TransactionRunner;
  clock: Clock;
  eventBus: EventBus;
  jobQueue: JobQueue;
}

export class InviteEmployee implements Command<InviteEmployeeInput, InvitationIssued> {
  constructor(private readonly deps: Deps) {}

  async execute(input: InviteEmployeeInput) {
    const {
      employeeDirectory,
      userRepository,
      invitationRepository,
      invitationTokens,
      invitationPolicy,
      idGenerator,
      transactionRunner,
      clock,
      eventBus,
      jobQueue,
    } = this.deps;

    // Un colaborador de otra empresa responde igual que uno inexistente: la ruta no debe servir
    // para averiguar qué ids existen en empresas ajenas.
    const employee = await employeeDirectory.find(input.employeeId);
    if (employee?.companyId !== input.companyId) {
      return err<DomainError>(new EmployeeNotFoundError());
    }
    if (!employee.active) return err<DomainError>(new EmployeeInactiveError());
    if (await userRepository.findByEmployeeId(employee.id)) {
      return err<DomainError>(new EmployeeAlreadyLinkedError());
    }

    const email = Email.create(input.email ?? employee.email);
    if (!email.ok) return email;
    if (await userRepository.findByEmail(email.value)) {
      return err<DomainError>(new EmailAlreadyRegisteredError());
    }

    const now = clock.now();
    const { token, tokenHash } = invitationTokens.issue();
    const invitation = Invitation.issue({
      id: idGenerator.next() as InvitationId,
      email: email.value,
      employeeId: employee.id,
      companyId: employee.companyId,
      tokenHash,
      invitedBy: input.invitedBy as UserId,
      ttlMs: invitationPolicy.ttlMs,
      now,
    });

    await transactionRunner.run(async () => {
      const previous = new Map<string, Invitation>();
      for (const old of await invitationRepository.findPendingForEmployee(employee.id, now)) {
        previous.set(old.id, old);
      }
      for (const old of await invitationRepository.findPendingForEmail(email.value, now)) {
        previous.set(old.id, old);
      }
      for (const old of previous.values()) {
        old.supersede(now);
        await invitationRepository.save(old);
      }
      await invitationRepository.save(invitation);
    });

    await eventBus.publish(invitation.pullEvents());

    const { expiresAt } = invitation.snapshot;
    const data: SendInvitationEmailData = {
      to: email.value.value,
      fullName: employee.fullName,
      link: `${invitationPolicy.appPublicUrl}/activar?token=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
    // `sensitive`: el enlace lleva el token en claro y no debe quedar en Valkey.
    await jobQueue.enqueue(SEND_INVITATION_EMAIL, data, { sensitive: true });

    return ok({ id: invitation.id, email: email.value.value, expiresAt: data.expiresAt });
  }
}
