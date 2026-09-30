import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@/shared/testing/fakes';

import { INVITATION_ISSUED } from '../../domain/invitation';
import { User, type UserId } from '../../domain/user';
import { CryptoInvitationTokens } from '../../infrastructure/crypto-invitation-tokens';
import { InMemoryInvitationRepository } from '../../infrastructure/in-memory/in-memory-invitation.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';
import { SEND_INVITATION_EMAIL } from '../jobs/send-invitation-email.job';

import { InviteExternal } from './invite-external.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const APP_URL = 'https://rrhh.example.test';
const TTL_MS = 3_600_000;
const INVITER = 'user-admin';

describe('InviteExternal', () => {
  let users: InMemoryUserRepository;
  let invitations: InMemoryInvitationRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let invite: InviteExternal;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    invitations = new InMemoryInvitationRepository();
    eventBus = new RecordingEventBus();
    jobQueue = new RecordingJobQueue();
    clock = new FixedClock();
    invite = new InviteExternal({
      userRepository: users,
      invitationRepository: invitations,
      invitationTokens: new CryptoInvitationTokens(),
      invitationPolicy: { ttlMs: TTL_MS, appPublicUrl: APP_URL },
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock,
      eventBus,
      jobQueue,
    });
  });

  it('camino feliz: invitación sin colaborador ni empresa y evento INVITATION_ISSUED', async () => {
    const result = await invite.execute({ email: 'Contador@Externo.com', invitedBy: INVITER });

    expect(result.ok && result.value.email).toBe('contador@externo.com');
    const [saved] = [...invitations.invitations.values()];
    expect(saved?.snapshot).toMatchObject({
      employeeId: null,
      companyId: null,
      invitedBy: INVITER,
    });
    expect(eventBus.names()).toEqual([INVITATION_ISSUED]);
  });

  it('encola el correo como sensitive, sin nombre y con enlace a /activar', async () => {
    await invite.execute({ email: 'contador@externo.com', invitedBy: INVITER });

    const [job] = jobQueue.jobs;
    expect(job?.name).toBe(SEND_INVITATION_EMAIL);
    expect(job?.options).toEqual({ sensitive: true });
    expect(job?.data).toMatchObject({ to: 'contador@externo.com', fullName: null });
    expect((job?.data as { link: string }).link).toContain(`${APP_URL}/activar?token=`);
  });

  it('correo inválido: INVALID_VALUE sin guardar ni encolar', async () => {
    const result = await invite.execute({ email: 'no-es-correo', invitedBy: INVITER });

    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
    expect(invitations.invitations.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
  });

  it('correo ya registrado: EMAIL_ALREADY_REGISTERED sin guardar ni encolar', async () => {
    const parsed = Email.create('contador@externo.com');
    if (!parsed.ok) throw parsed.error;
    const existing = User.register({
      id: 'user-1' as UserId,
      email: parsed.value,
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(existing.id, existing);

    const result = await invite.execute({ email: 'contador@externo.com', invitedBy: INVITER });

    expect(!result.ok && result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(invitations.invitations.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
  });

  it('invitar de nuevo al mismo correo reemplaza la pendiente', async () => {
    await invite.execute({ email: 'contador@externo.com', invitedBy: INVITER });
    const [first] = [...invitations.invitations.values()];

    await invite.execute({ email: 'contador@externo.com', invitedBy: INVITER });

    expect(first?.isPendingAt(clock.now())).toBe(false);
    const pending = [...invitations.invitations.values()].filter((i) => i.isPendingAt(clock.now()));
    expect(pending).toHaveLength(1);
  });
});
