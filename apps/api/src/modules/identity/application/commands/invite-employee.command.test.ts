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
import type { EmployeeDirectory, InvitableEmployee } from '../ports/employee-directory';

import { InviteEmployee } from './invite-employee.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

class StubEmployeeDirectory implements EmployeeDirectory {
  constructor(private readonly employees: InvitableEmployee[]) {}

  find(employeeId: string): Promise<InvitableEmployee | null> {
    return Promise.resolve(this.employees.find((e) => e.id === employeeId) ?? null);
  }
}

const COMPANY = 'company-a';
const OTHER_COMPANY = 'company-b';
const INVITER = 'user-rrhh';
const APP_URL = 'https://rrhh.example.test';
const TTL_MS = 3_600_000;

const ana: InvitableEmployee = {
  id: 'employee-ana',
  companyId: COMPANY,
  email: 'ana@aps.cl',
  fullName: 'Ana Rojas',
  active: true,
};
const terminated: InvitableEmployee = { ...ana, id: 'employee-baja', active: false };
const foreign: InvitableEmployee = { ...ana, id: 'employee-ajeno', companyId: OTHER_COMPANY };

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('InviteEmployee', () => {
  let users: InMemoryUserRepository;
  let invitations: InMemoryInvitationRepository;
  let eventBus: RecordingEventBus;
  let jobQueue: RecordingJobQueue;
  let clock: FixedClock;
  let invite: InviteEmployee;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    invitations = new InMemoryInvitationRepository();
    eventBus = new RecordingEventBus();
    jobQueue = new RecordingJobQueue();
    clock = new FixedClock();
    invite = new InviteEmployee({
      employeeDirectory: new StubEmployeeDirectory([ana, terminated, foreign]),
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

  const input = { companyId: COMPANY, employeeId: ana.id, invitedBy: INVITER };

  it('camino feliz: usa el correo de la ficha, guarda la invitación y publica INVITATION_ISSUED', async () => {
    const result = await invite.execute(input);

    expect(result.ok && result.value).toMatchObject({
      email: 'ana@aps.cl',
      expiresAt: new Date(clock.now().getTime() + TTL_MS).toISOString(),
    });
    expect(invitations.invitations.size).toBe(1);
    const [saved] = [...invitations.invitations.values()];
    expect(saved?.snapshot).toMatchObject({
      employeeId: ana.id,
      companyId: COMPANY,
      invitedBy: INVITER,
    });
    expect(eventBus.names()).toEqual([INVITATION_ISSUED]);
  });

  it('con correo editado: la invitación y el resultado llevan ese correo, no el de la ficha', async () => {
    const result = await invite.execute({ ...input, email: 'Ana.Nueva@APS.cl' });

    expect(result.ok && result.value.email).toBe('ana.nueva@aps.cl');
    const [saved] = [...invitations.invitations.values()];
    expect(saved?.snapshot.email.value).toBe('ana.nueva@aps.cl');
  });

  it('encola el correo como sensitive, con enlace a /activar y sin guardar el token en claro', async () => {
    await invite.execute(input);

    expect(jobQueue.jobs).toHaveLength(1);
    const [job] = jobQueue.jobs;
    expect(job?.name).toBe(SEND_INVITATION_EMAIL);
    expect(job?.options).toEqual({ sensitive: true });
    expect(job?.data).toMatchObject({ to: 'ana@aps.cl', fullName: 'Ana Rojas' });
    const { link } = job?.data as { link: string };
    expect(link.startsWith(`${APP_URL}/activar?token=`)).toBe(true);
    const token = link.slice(`${APP_URL}/activar?token=`.length);
    expect(token.length).toBeGreaterThan(20);
    const [saved] = [...invitations.invitations.values()];
    expect(saved?.snapshot.tokenHash).not.toBe(token);
    expect(saved?.snapshot.tokenHash).toBe(new CryptoInvitationTokens().hashOf(token));
  });

  it('el resultado no expone el token ni su hash', async () => {
    const result = await invite.execute(input);

    expect(result.ok && Object.keys(result.value).sort()).toEqual(['email', 'expiresAt', 'id']);
  });

  it.each([
    ['colaborador inexistente', { employeeId: 'nadie' }, 'EMPLOYEE_NOT_FOUND'],
    ['colaborador de otra empresa', { employeeId: foreign.id }, 'EMPLOYEE_NOT_FOUND'],
    ['colaborador desvinculado', { employeeId: terminated.id }, 'EMPLOYEE_INACTIVE'],
    ['correo inválido', { email: 'no-es-correo' }, 'INVALID_VALUE'],
  ])('rechaza %s sin guardar ni encolar nada', async (_case, overrides, code) => {
    const result = await invite.execute({ ...input, ...overrides });

    expect(!result.ok && result.error.code).toBe(code);
    expect(invitations.invitations.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
    expect(eventBus.published).toEqual([]);
  });

  it('colaborador de otra empresa responde igual que uno inexistente (mismo mensaje)', async () => {
    const missing = await invite.execute({ ...input, employeeId: 'nadie' });
    const other = await invite.execute({ ...input, employeeId: foreign.id });

    if (missing.ok || other.ok) throw new Error('se esperaban dos errores');
    expect(other.error.message).toBe(missing.error.message);
  });

  it('colaborador que ya tiene una cuenta vinculada: EMPLOYEE_ALREADY_HAS_ACCESS', async () => {
    const linked = User.register({
      id: 'user-ana' as UserId,
      email: mustEmail('otro@aps.cl'),
      passwordHash: 'hash',
      employeeId: ana.id,
      now: clock.now(),
    });
    users.users.set(linked.id, linked);

    const result = await invite.execute(input);

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_HAS_ACCESS');
    expect(invitations.invitations.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
  });

  it('correo ya registrado por otra cuenta: EMAIL_ALREADY_REGISTERED', async () => {
    const other = User.register({
      id: 'user-otro' as UserId,
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(other.id, other);

    const result = await invite.execute(input);

    expect(!result.ok && result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(invitations.invitations.size).toBe(0);
    expect(jobQueue.jobs).toEqual([]);
  });

  it('el correo editado también se compara contra las cuentas existentes', async () => {
    const other = User.register({
      id: 'user-otro' as UserId,
      email: mustEmail('editado@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(other.id, other);

    const result = await invite.execute({ ...input, email: 'editado@aps.cl' });

    expect(!result.ok && result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('invitar de nuevo reemplaza la pendiente del colaborador: solo la nueva sigue vigente', async () => {
    await invite.execute(input);
    const [first] = [...invitations.invitations.values()];

    await invite.execute(input);

    expect(invitations.invitations.size).toBe(2);
    expect(first?.snapshot.revokedAt).toEqual(clock.now());
    const pending = [...invitations.invitations.values()].filter((i) => i.isPendingAt(clock.now()));
    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).not.toBe(first?.id);
  });

  it('invitar con otro correo al mismo colaborador también reemplaza la anterior', async () => {
    await invite.execute(input);
    const [first] = [...invitations.invitations.values()];

    await invite.execute({ ...input, email: 'ana.otra@aps.cl' });

    expect(first?.isPendingAt(clock.now())).toBe(false);
  });

  it('una invitación pendiente al mismo correo (de otro colaborador) también se reemplaza', async () => {
    const pedro: InvitableEmployee = { ...ana, id: 'employee-pedro', fullName: 'Pedro Soto' };
    const both = new InviteEmployee({
      employeeDirectory: new StubEmployeeDirectory([ana, pedro]),
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
    await both.execute(input);
    const [forAna] = [...invitations.invitations.values()];

    await both.execute({ companyId: COMPANY, employeeId: pedro.id, invitedBy: INVITER });

    expect(forAna?.isPendingAt(clock.now())).toBe(false);
  });

  it('una invitación ya expirada no se marca como reemplazada al invitar otra vez', async () => {
    await invite.execute(input);
    const [first] = [...invitations.invitations.values()];
    clock.set(new Date(clock.now().getTime() + TTL_MS + 1));

    await invite.execute(input);

    expect(first?.snapshot.revokedAt).toBeNull();
  });
});
