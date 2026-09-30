import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { Invitation, type InvitationId } from '../../domain/invitation';
import { Session, type SessionId } from '../../domain/session';
import { USER_DISABLED, User, type UserId } from '../../domain/user';
import { InMemoryInvitationRepository } from '../../infrastructure/in-memory/in-memory-invitation.repository';
import { InMemorySessionRepository } from '../../infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserRepository } from '../../infrastructure/in-memory/in-memory-user.repository';

import { DisableTerminatedEmployee } from './disable-terminated-employee.command';

class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const EMPLOYEE = 'employee-ana';

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('DisableTerminatedEmployee', () => {
  let users: InMemoryUserRepository;
  let sessions: InMemorySessionRepository;
  let invitations: InMemoryInvitationRepository;
  let eventBus: RecordingEventBus;
  let clock: FixedClock;
  let disable: DisableTerminatedEmployee;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    sessions = new InMemorySessionRepository();
    invitations = new InMemoryInvitationRepository();
    eventBus = new RecordingEventBus();
    clock = new FixedClock();
    disable = new DisableTerminatedEmployee({
      userRepository: users,
      sessionRepository: sessions,
      invitationRepository: invitations,
      transactionRunner: new NoopTransactionRunner(),
      clock,
      eventBus,
    });
  });

  function seedUser(id: string, employeeId: string | null): User {
    const user = User.register({
      id: id as UserId,
      email: mustEmail(`${id}@aps.cl`),
      passwordHash: 'hash',
      employeeId,
      now: clock.now(),
    });
    user.pullEvents();
    users.users.set(user.id, user);
    return user;
  }

  function seedSession(id: string, userId: UserId): Session {
    const session = Session.start({
      id: id as SessionId,
      userId,
      tokenHash: id.padEnd(64, '0'),
      client: 'WEB',
      lifetime: { absoluteMs: 3_600_000, idleMs: null },
      now: clock.now(),
      ip: null,
      userAgent: null,
    });
    sessions.sessions.set(session.id, session);
    return session;
  }

  function seedInvitation(id: string, employeeId: string): Invitation {
    const invitation = Invitation.issue({
      id: id as InvitationId,
      email: mustEmail(`${id}@aps.cl`),
      employeeId,
      companyId: 'company-a',
      tokenHash: id.padEnd(64, '0'),
      invitedBy: 'user-admin' as UserId,
      ttlMs: 3_600_000,
      now: clock.now(),
    });
    invitations.invitations.set(invitation.id, invitation);
    return invitation;
  }

  it('deshabilita al usuario vinculado y publica USER_DISABLED', async () => {
    const user = seedUser('user-ana', EMPLOYEE);

    const result = await disable.execute({ employeeId: EMPLOYEE });

    expect(result.ok).toBe(true);
    expect(users.users.get(user.id)?.snapshot.status).toBe('DISABLED');
    expect(eventBus.names()).toEqual([USER_DISABLED]);
  });

  it('cierra todas las sesiones abiertas del usuario y respeta las de otros usuarios', async () => {
    const ana = seedUser('user-ana', EMPLOYEE);
    const pedro = seedUser('user-pedro', 'employee-pedro');
    const s1 = seedSession('s1', ana.id);
    const s2 = seedSession('s2', ana.id);
    const other = seedSession('s3', pedro.id);

    await disable.execute({ employeeId: EMPLOYEE });

    expect(s1.snapshot.revokedAt).toBeNull();
    expect(sessions.sessions.get(s1.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(sessions.sessions.get(s2.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(sessions.sessions.get(other.id)?.snapshot.revokedAt).toBeNull();
    expect(users.users.get(pedro.id)?.snapshot.status).toBe('ACTIVE');
  });

  it('reemplaza las invitaciones pendientes del colaborador y deja las de otros', async () => {
    seedUser('user-ana', EMPLOYEE);
    const pending = seedInvitation('inv-1', EMPLOYEE);
    const foreign = seedInvitation('inv-2', 'employee-pedro');

    await disable.execute({ employeeId: EMPLOYEE });

    expect(invitations.invitations.get(pending.id)?.snapshot.revokedAt).toEqual(clock.now());
    expect(invitations.invitations.get(foreign.id)?.isPendingAt(clock.now())).toBe(true);
  });

  it('colaborador sin cuenta: ok sin eventos, pero reemplaza su invitación pendiente', async () => {
    const pending = seedInvitation('inv-1', EMPLOYEE);

    const result = await disable.execute({ employeeId: EMPLOYEE });

    expect(result.ok).toBe(true);
    expect(eventBus.published).toEqual([]);
    expect(invitations.invitations.get(pending.id)?.snapshot.revokedAt).toEqual(clock.now());
  });

  it('es idempotente: repetir el evento no vuelve a publicar ni cambia las marcas', async () => {
    const ana = seedUser('user-ana', EMPLOYEE);
    const session = seedSession('s1', ana.id);
    await disable.execute({ employeeId: EMPLOYEE });
    const firstRevokedAt = sessions.sessions.get(session.id)?.snapshot.revokedAt;
    clock.set(new Date('2026-02-01T00:00:00Z'));

    const again = await disable.execute({ employeeId: EMPLOYEE });

    expect(again.ok).toBe(true);
    expect(eventBus.names()).toEqual([USER_DISABLED]);
    expect(sessions.sessions.get(session.id)?.snapshot.revokedAt).toEqual(firstRevokedAt);
    expect(users.users.get(ana.id)?.snapshot.status).toBe('DISABLED');
  });
});
