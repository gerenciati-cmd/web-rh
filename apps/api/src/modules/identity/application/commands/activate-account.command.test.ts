import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { INVITATION_ACCEPTED, Invitation, type InvitationId } from '../../domain/invitation';
import { ROLE_ASSIGNED } from '../../domain/role-assignment';
import { USER_REGISTERED, User, type UserId } from '../../domain/user';
import { CryptoInvitationTokens } from '../../infrastructure/crypto-invitation-tokens';
import { FakePasswordHasher } from '../../infrastructure/in-memory/fake-password-hasher';
import { InMemoryInvitationRepository } from '../../infrastructure/in-memory/in-memory-invitation.repository';
import { InMemoryRoleAssignmentRepository } from '../../infrastructure/in-memory/in-memory-role-assignment.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';
import type { EmployeeDirectory, InvitableEmployee } from '../ports/employee-directory';

import { ActivateAccount } from './activate-account.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

/** Como el runner real: si el trabajo lanza, la transacción se revierte y el error se propaga. */
class RollbackSpyTransactionRunner implements TransactionRunner {
  rolledBack = 0;

  async run<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      this.rolledBack += 1;
      throw error;
    }
  }
}

/** Simula que otra transacción (baja, nueva invitación) cerró la invitación antes del commit. */
class LosingInvitationRepository extends InMemoryInvitationRepository {
  override save(): Promise<boolean> {
    return Promise.resolve(false);
  }
}

class StubEmployeeDirectory implements EmployeeDirectory {
  employees = new Map<string, InvitableEmployee>();

  find(employeeId: string): Promise<InvitableEmployee | null> {
    return Promise.resolve(this.employees.get(employeeId) ?? null);
  }
}

const COMPANY = 'company-a';
const PASSWORD = 'contraseña-larga-y-valida';
const TTL_MS = 3_600_000;
const ana: InvitableEmployee = {
  id: 'employee-ana',
  companyId: COMPANY,
  email: 'ana@aps.cl',
  fullName: 'Ana Rojas',
  active: true,
};

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('ActivateAccount', () => {
  let users: InMemoryUserRepository;
  let invitations: InMemoryInvitationRepository;
  let roleAssignments: InMemoryRoleAssignmentRepository;
  let directory: StubEmployeeDirectory;
  let eventBus: RecordingEventBus;
  let clock: FixedClock;
  let tokens: CryptoInvitationTokens;
  let activate: ActivateAccount;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    invitations = new InMemoryInvitationRepository();
    roleAssignments = new InMemoryRoleAssignmentRepository({ userRepository: users });
    directory = new StubEmployeeDirectory();
    directory.employees.set(ana.id, ana);
    eventBus = new RecordingEventBus();
    clock = new FixedClock();
    tokens = new CryptoInvitationTokens();
    activate = new ActivateAccount({
      invitationRepository: invitations,
      invitationTokens: tokens,
      userRepository: users,
      roleAssignmentRepository: roleAssignments,
      employeeDirectory: directory,
      passwordHasher: new FakePasswordHasher(),
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: new NoopTransactionRunner(),
      clock,
      eventBus,
    });
  });

  /** Guarda una invitación vigente y devuelve su token en claro. */
  function seedInvitation(options: { employeeId: string | null; email?: string }): {
    token: string;
    invitation: Invitation;
  } {
    const { token, tokenHash } = tokens.issue();
    const invitation = Invitation.issue({
      id: `inv-${String(invitations.invitations.size + 1)}` as InvitationId,
      email: mustEmail(options.email ?? 'ana@aps.cl'),
      employeeId: options.employeeId,
      companyId: options.employeeId === null ? null : COMPANY,
      tokenHash,
      invitedBy: 'user-admin' as UserId,
      ttlMs: TTL_MS,
      now: clock.now(),
    });
    invitation.pullEvents();
    invitations.invitations.set(invitation.id, invitation);
    return { token, invitation };
  }

  it('con colaborador: crea el usuario vinculado, acepta la invitación y concede EMPLOYEE en su empresa', async () => {
    const { token, invitation } = seedInvitation({ employeeId: ana.id });

    const result = await activate.execute({ token, password: PASSWORD });

    expect(result.ok).toBe(true);
    const [user] = [...users.users.values()];
    expect(user?.snapshot).toMatchObject({ employeeId: ana.id, status: 'ACTIVE' });
    expect(user?.snapshot.email.value).toBe('ana@aps.cl');
    expect(invitation.snapshot.acceptedAt).toEqual(clock.now());
    const active = [...roleAssignments.assignments.values()].filter((a) => a.isActive);
    expect(active).toHaveLength(1);
    expect(active[0]?.snapshot).toMatchObject({
      userId: user?.id,
      role: 'EMPLOYEE',
      companyId: COMPANY,
      assignedBy: null,
    });
    expect(eventBus.names()).toEqual([USER_REGISTERED, INVITATION_ACCEPTED, ROLE_ASSIGNED]);
  });

  it('guarda la contraseña hasheada, nunca en claro', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });

    await activate.execute({ token, password: PASSWORD });

    const [user] = [...users.users.values()];
    expect(user?.snapshot.passwordHash).toBe(`fake:${PASSWORD}`);
  });

  it('invitación externa: usuario con employeeId null y sin ningún rol', async () => {
    const { token } = seedInvitation({ employeeId: null, email: 'contador@externo.com' });

    const result = await activate.execute({ token, password: PASSWORD });

    expect(result.ok).toBe(true);
    const [user] = [...users.users.values()];
    expect(user?.snapshot.employeeId).toBeNull();
    expect(roleAssignments.assignments.size).toBe(0);
    expect(eventBus.names()).toEqual([USER_REGISTERED, INVITATION_ACCEPTED]);
  });

  it('contraseña débil: WEAK_PASSWORD, sin consumir la invitación ni crear usuario', async () => {
    const { token, invitation } = seedInvitation({ employeeId: ana.id });

    const result = await activate.execute({ token, password: 'corta' });

    expect(!result.ok && result.error.code).toBe('WEAK_PASSWORD');
    expect(users.users.size).toBe(0);
    expect(invitation.isPendingAt(clock.now())).toBe(true);
  });

  it('token desconocido: INVITATION_NOT_VALID', async () => {
    const result = await activate.execute({ token: 'token-inventado', password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(users.users.size).toBe(0);
  });

  it('segundo uso del mismo token: INVITATION_NOT_VALID y no se crea otro usuario', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });
    await activate.execute({ token, password: PASSWORD });

    const second = await activate.execute({ token, password: PASSWORD });

    expect(!second.ok && second.error.code).toBe('INVITATION_NOT_VALID');
    expect(users.users.size).toBe(1);
  });

  it('token expirado: INVITATION_NOT_VALID', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });
    clock.set(new Date(clock.now().getTime() + TTL_MS));

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(users.users.size).toBe(0);
  });

  it('token reemplazado: INVITATION_NOT_VALID', async () => {
    const { token, invitation } = seedInvitation({ employeeId: ana.id });
    invitation.supersede(clock.now());

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
  });

  it('desconocido, usado y reemplazado responden con el mismo cuerpo', async () => {
    const unknown = await activate.execute({ token: 'x', password: PASSWORD });
    const used = seedInvitation({ employeeId: null, email: 'a@externo.com' });
    await activate.execute({ token: used.token, password: PASSWORD });
    const usedAgain = await activate.execute({ token: used.token, password: PASSWORD });
    const superseded = seedInvitation({ employeeId: null, email: 'b@externo.com' });
    superseded.invitation.supersede(clock.now());
    const supersededResult = await activate.execute({
      token: superseded.token,
      password: PASSWORD,
    });

    for (const result of [unknown, usedAgain, supersededResult]) {
      expect(!result.ok && { code: result.error.code, message: result.error.message }).toEqual({
        code: 'INVITATION_NOT_VALID',
        message: 'La invitación no es válida o ya expiró',
      });
    }
  });

  it('el correo ya fue registrado entre la invitación y la activación: EMAIL_ALREADY_REGISTERED', async () => {
    const { token, invitation } = seedInvitation({ employeeId: ana.id });
    const other = User.register({
      id: 'user-otro' as UserId,
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      now: clock.now(),
    });
    users.users.set(other.id, other);

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('EMAIL_ALREADY_REGISTERED');
    expect(invitation.isPendingAt(clock.now())).toBe(true);
    expect(roleAssignments.assignments.size).toBe(0);
  });

  it('el colaborador fue desvinculado después de invitar: INVITATION_NOT_VALID sin crear nada', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });
    directory.employees.set(ana.id, { ...ana, active: false });

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(users.users.size).toBe(0);
    expect(roleAssignments.assignments.size).toBe(0);
  });

  it('el colaborador ya no existe en el directorio: INVITATION_NOT_VALID', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });
    directory.employees.delete(ana.id);

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
  });

  it('el colaborador ya tiene otra cuenta vinculada: EMPLOYEE_ALREADY_HAS_ACCESS', async () => {
    const { token } = seedInvitation({ employeeId: ana.id });
    const linked = User.register({
      id: 'user-previo' as UserId,
      email: mustEmail('previo@aps.cl'),
      passwordHash: 'hash',
      employeeId: ana.id,
      now: clock.now(),
    });
    users.users.set(linked.id, linked);

    const result = await activate.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('EMPLOYEE_ALREADY_HAS_ACCESS');
    expect(users.users.size).toBe(1);
  });

  it('la invitación fue cerrada entre la lectura y el commit (carrera con la baja): INVITATION_NOT_VALID, transacción revertida, sin rol ni eventos', async () => {
    const runner = new RollbackSpyTransactionRunner();
    const losing = new LosingInvitationRepository();
    const loser = new ActivateAccount({
      invitationRepository: losing,
      invitationTokens: tokens,
      userRepository: users,
      roleAssignmentRepository: roleAssignments,
      employeeDirectory: directory,
      passwordHasher: new FakePasswordHasher(),
      idGenerator: new SequentialIdGenerator(),
      transactionRunner: runner,
      clock,
      eventBus,
    });
    const { token, tokenHash } = tokens.issue();
    const invitation = Invitation.issue({
      id: 'inv-race' as InvitationId,
      email: mustEmail('ana@aps.cl'),
      employeeId: ana.id,
      companyId: COMPANY,
      tokenHash,
      invitedBy: 'user-admin' as UserId,
      ttlMs: TTL_MS,
      now: clock.now(),
    });
    invitation.pullEvents();
    losing.invitations.set(invitation.id, invitation);

    const result = await loser.execute({ token, password: PASSWORD });

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(runner.rolledBack).toBe(1);
    expect(roleAssignments.assignments.size).toBe(0);
    expect(eventBus.published).toEqual([]);
  });

  it('no abre sesión ni publica nada si la activación falla', async () => {
    const result = await activate.execute({ token: 'x', password: PASSWORD });

    expect(result.ok).toBe(false);
    expect(eventBus.published).toEqual([]);
  });
});
