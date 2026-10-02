import { Email, PERMISSIONS, type Role } from '@rrhh/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock } from '@/shared/testing/fakes';

import { RoleAssignment, type RoleAssignmentId } from '../domain/role-assignment';
import { Session, type SessionId } from '../domain/session';
import { User, type UserId } from '../domain/user';
import { CryptoSessionTokens } from '../infrastructure/crypto-session-tokens';
import { InMemoryRoleAssignmentRepository } from '../infrastructure/in-memory/in-memory-role-assignment.repository';
import { InMemorySessionRepository } from '../infrastructure/in-memory/in-memory-session.repository';
import { InMemoryUserRepository } from '../infrastructure/in-memory/in-memory-user.repository';

import { SessionAuthenticator } from './session-authenticator';

const now = new Date('2026-01-15T12:00:00Z');
const USER_ID = 'user-1' as UserId;

describe('SessionAuthenticator', () => {
  let userRepository: InMemoryUserRepository;
  let sessionRepository: InMemorySessionRepository;
  let sessionTokens: CryptoSessionTokens;
  let clock: FixedClock;
  let roleAssignmentRepository: InMemoryRoleAssignmentRepository;
  let authenticator: SessionAuthenticator;

  beforeEach(() => {
    userRepository = new InMemoryUserRepository();
    sessionRepository = new InMemorySessionRepository();
    sessionTokens = new CryptoSessionTokens();
    clock = new FixedClock(now);
    roleAssignmentRepository = new InMemoryRoleAssignmentRepository({ userRepository });
    authenticator = new SessionAuthenticator({
      sessionRepository,
      userRepository,
      roleAssignmentRepository,
      sessionTokens,
      clock,
    });

    const user = User.restore(USER_ID, {
      email: mustEmail('ana@aps.cl'),
      passwordHash: 'hash',
      employeeId: null,
      status: 'ACTIVE',
    });
    userRepository.users.set(user.id, user);
  });

  function issueSession(overrides: Partial<Parameters<typeof Session.start>[0]> = {}): {
    session: Session;
    token: string;
  } {
    const { token, tokenHash } = sessionTokens.issue();
    const session = Session.start({
      id: 'session-1' as SessionId,
      userId: USER_ID,
      tokenHash,
      client: 'WEB',
      lifetime: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
      now,
      ip: null,
      userAgent: null,
      ...overrides,
    });
    sessionRepository.sessions.set(session.id, session);
    return { session, token };
  }

  it('token desconocido: resuelve null', async () => {
    const actor = await authenticator.authenticate('token-que-no-existe');
    expect(actor).toBeNull();
  });

  it('sesión revocada: resuelve null', async () => {
    const { session, token } = issueSession();
    session.revoke(now);
    sessionRepository.sessions.set(session.id, session);

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión vencida (expiresAt <= now): resuelve null', async () => {
    const { token } = issueSession({ now: new Date(now.getTime() - 13 * 3_600_000) });

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión de un usuario que ya no existe: resuelve null', async () => {
    const { token } = issueSession();
    userRepository.users.delete(USER_ID);

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión de un usuario DISABLED: resuelve null', async () => {
    const { token } = issueSession();
    userRepository.users.set(
      USER_ID,
      User.restore(USER_ID, {
        email: mustEmail('ana@aps.cl'),
        passwordHash: 'hash',
        employeeId: null,
        status: 'DISABLED',
      }),
    );

    expect(await authenticator.authenticate(token)).toBeNull();
  });

  it('sesión activa y reciente: resuelve el actor y NO toca lastSeenAt (needsTouch=false)', async () => {
    const { session, token } = issueSession();
    const recordActivitySpy = vi.spyOn(sessionRepository, 'recordActivity');

    const actor = await authenticator.authenticate(token);

    expect(actor).toEqual({ userId: USER_ID, sessionId: session.id, grants: [] });
    expect(recordActivitySpy).not.toHaveBeenCalled();
  });

  function assignRole(id: string, role: Role, companyId: string | null, userId: UserId = USER_ID) {
    const result = RoleAssignment.assign({
      id: id as RoleAssignmentId,
      userId,
      role,
      companyId,
      assignedBy: null,
      now,
    });
    if (!result.ok) throw result.error;
    roleAssignmentRepository.assignments.set(id, result.value);
    return result.value;
  }

  it('expande las asignaciones activas del usuario a concesiones en el actor', async () => {
    const { token } = issueSession();
    assignRole('a1', 'HR', 'company-a');

    const actor = await authenticator.authenticate(token);

    expect(actor?.grants).toHaveLength(9);
    expect(actor?.grants).toContainEqual({ permission: 'employees:read', companyId: 'company-a' });
    expect(actor?.grants.map((grant) => grant.permission)).not.toContain(
      'organization.companies:create',
    );
  });

  it('HOLDING_ADMIN: una concesión de holding (companyId null) por cada permiso', async () => {
    const { token } = issueSession();
    assignRole('a1', 'HOLDING_ADMIN', null);

    const actor = await authenticator.authenticate(token);

    expect(actor?.grants).toHaveLength(PERMISSIONS.length);
    expect(actor?.grants.every((grant) => grant.companyId === null)).toBe(true);
  });

  it('ignora asignaciones revocadas y las de otros usuarios', async () => {
    const { token } = issueSession();
    assignRole('a1', 'HR', 'company-a').revoke(USER_ID, now);
    assignRole('a2', 'HOLDING_ADMIN', null, 'user-2' as UserId);

    const actor = await authenticator.authenticate(token);

    expect(actor?.grants).toEqual([]);
  });

  it('revocar el rol surte efecto en la siguiente autenticación con el mismo token', async () => {
    const { token } = issueSession();
    const assignment = assignRole('a1', 'HR', 'company-a');
    expect((await authenticator.authenticate(token))?.grants).toHaveLength(9);

    assignment.revoke(USER_ID, now);

    expect((await authenticator.authenticate(token))?.grants).toEqual([]);
  });

  it('sesión activa pero con lastSeenAt viejo: hace touch y registra la actividad (no `save`, H2)', async () => {
    const { session, token } = issueSession();
    // needsTouch es true a partir de 60s sin actividad.
    clock.set(new Date(now.getTime() + 61_000));
    const recordActivitySpy = vi.spyOn(sessionRepository, 'recordActivity');
    const saveSpy = vi.spyOn(sessionRepository, 'save');

    const actor = await authenticator.authenticate(token);

    expect(actor).toEqual({ userId: USER_ID, sessionId: session.id, grants: [] });
    expect(recordActivitySpy).toHaveBeenCalledTimes(1);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(sessionRepository.sessions.get(session.id)?.snapshot.lastSeenAt).toEqual(clock.now());
  });
});

// H2 (plan 001, paso 15): el guard vive en el repositorio, no en `SessionAuthenticator` — se
// prueba directo sobre `InMemorySessionRepository.recordActivity` con dos instancias
// independientes de la misma sesión (como dos requests reales que la leyeron cada una por su
// cuenta), no con la misma referencia, para no enmascarar la carrera con una mutación compartida.
describe('InMemorySessionRepository.recordActivity (H2)', () => {
  let sessionRepository: InMemorySessionRepository;

  beforeEach(() => {
    sessionRepository = new InMemorySessionRepository();
  });

  function startSession(): Session {
    const { tokenHash } = new CryptoSessionTokens().issue();
    const session = Session.start({
      id: 'session-race' as SessionId,
      userId: USER_ID,
      tokenHash,
      client: 'WEB',
      lifetime: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
      now,
      ip: null,
      userAgent: null,
    });
    sessionRepository.sessions.set(session.id, session);
    return session;
  }

  it('no revive una sesión que un logout concurrente ya revocó', async () => {
    const original = startSession();
    const snapshot = original.snapshot;
    // Dos copias independientes de la misma fila (Session.restore crea una instancia nueva).
    const staleCopyHeldByRequestA = Session.restore(original.id, { ...snapshot });
    const copyRevokedByRequestB = Session.restore(original.id, { ...snapshot });

    // Petición B: logout concurrente, revoca y guarda antes que A.
    copyRevokedByRequestB.revoke(new Date(now.getTime() + 30_000));
    await sessionRepository.save(copyRevokedByRequestB);

    // Petición A sigue con su copia vieja (revokedAt todavía null ahí) y llega tarde a tocar.
    staleCopyHeldByRequestA.touch(new Date(now.getTime() + 61_000));
    await sessionRepository.recordActivity(staleCopyHeldByRequestA);

    const stored = sessionRepository.sessions.get(original.id);
    expect(stored?.snapshot.revokedAt).not.toBeNull();
    expect(stored?.snapshot.lastSeenAt).toEqual(copyRevokedByRequestB.snapshot.lastSeenAt);
  });

  it('actualiza lastSeenAt cuando la sesión sigue sin revocar', async () => {
    const original = startSession();
    const copy = Session.restore(original.id, { ...original.snapshot });
    const later = new Date(now.getTime() + 61_000);
    copy.touch(later);

    await sessionRepository.recordActivity(copy);

    expect(sessionRepository.sessions.get(original.id)?.snapshot.lastSeenAt).toEqual(later);
    expect(sessionRepository.sessions.get(original.id)?.snapshot.revokedAt).toBeNull();
  });
});

function mustEmail(raw: string) {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}
