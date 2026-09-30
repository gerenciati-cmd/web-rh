import { Email, err, ok, type DomainError } from '@rrhh/domain';

import type { JobQueue } from '@/shared/application/jobs';
import type { Clock, EventBus, IdGenerator, TransactionRunner } from '@/shared/application/ports';
import type { Command } from '@/shared/application/use-case';

import { EmailAlreadyRegisteredError } from '../../domain/errors';
import { Invitation, type InvitationId } from '../../domain/invitation';
import type { InvitationRepository } from '../../domain/invitation.repository';
import type { UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';
import {
  SEND_INVITATION_EMAIL,
  type SendInvitationEmailData,
} from '../jobs/send-invitation-email.job';
import type { InvitationPolicy, InvitationTokens } from '../ports/invitation-tokens';

import type { InvitationIssued } from './invite-employee.command';

export interface InviteExternalInput {
  email: string;
  invitedBy: string;
}

interface Deps {
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

/** Invita a alguien que no es colaborador (p. ej. un contador externo): sin vínculo ni rol. */
export class InviteExternal implements Command<InviteExternalInput, InvitationIssued> {
  constructor(private readonly deps: Deps) {}

  async execute(input: InviteExternalInput) {
    const {
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

    const email = Email.create(input.email);
    if (!email.ok) return email;
    if (await userRepository.findByEmail(email.value)) {
      return err<DomainError>(new EmailAlreadyRegisteredError());
    }

    const now = clock.now();
    const { token, tokenHash } = invitationTokens.issue();
    const invitation = Invitation.issue({
      id: idGenerator.next() as InvitationId,
      email: email.value,
      employeeId: null,
      companyId: null,
      tokenHash,
      invitedBy: input.invitedBy as UserId,
      ttlMs: invitationPolicy.ttlMs,
      now,
    });

    await transactionRunner.run(async () => {
      for (const old of await invitationRepository.findPendingForEmail(email.value, now)) {
        old.supersede(now);
        await invitationRepository.save(old);
      }
      await invitationRepository.save(invitation);
    });

    await eventBus.publish(invitation.pullEvents());

    const data: SendInvitationEmailData = {
      to: email.value.value,
      fullName: null,
      link: `${invitationPolicy.appPublicUrl}/activar?token=${token}`,
      expiresAt: invitation.snapshot.expiresAt.toISOString(),
    };
    await jobQueue.enqueue(SEND_INVITATION_EMAIL, data, { sensitive: true });

    return ok({ id: invitation.id, email: email.value.value, expiresAt: data.expiresAt });
  }
}
