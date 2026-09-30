import type { Role } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import {
  ROLE_ASSIGNED,
  ROLE_REVOKED,
  RoleAssignment,
  type RoleAssignmentId,
} from './role-assignment';
import type { UserId } from './user';

const NOW = new Date('2026-01-15T12:00:00Z');
const LATER = new Date('2026-01-16T12:00:00Z');
const ID = 'assignment-1' as RoleAssignmentId;
const USER = 'user-1' as UserId;
const ADMIN = 'user-admin' as UserId;
const COMPANY = 'company-a';

function assign(role: Role, companyId: string | null, assignedBy: UserId | null = ADMIN) {
  return RoleAssignment.assign({ id: ID, userId: USER, role, companyId, assignedBy, now: NOW });
}

function assigned(role: Role = 'HR', companyId: string | null = COMPANY): RoleAssignment {
  const result = assign(role, companyId);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('RoleAssignment.assign', () => {
  it('HR con empresa: queda activa, con quién y cuándo, y emite ROLE_ASSIGNED', () => {
    const assignment = assigned('HR', COMPANY);

    expect(assignment.isActive).toBe(true);
    expect(assignment.snapshot).toEqual({
      userId: USER,
      role: 'HR',
      companyId: COMPANY,
      assignedAt: NOW,
      assignedBy: ADMIN,
      revokedAt: null,
      revokedBy: null,
    });
    const events = assignment.pullEvents();
    expect(events.map((event) => event.name)).toEqual([ROLE_ASSIGNED]);
    expect(events[0]?.payload).toMatchObject({ userId: USER, role: 'HR', companyId: COMPANY });
  });

  it('HOLDING_ADMIN sin empresa es válido; assignedBy null = sembrado por el sistema', () => {
    const result = assign('HOLDING_ADMIN', null, null);

    expect(result.ok && result.value.snapshot.assignedBy).toBeNull();
  });

  it('HOLDING_ADMIN con empresa: INVALID_ROLE_SCOPE', () => {
    const result = assign('HOLDING_ADMIN', COMPANY);

    expect(!result.ok && result.error.code).toBe('INVALID_ROLE_SCOPE');
  });

  it('HR sin empresa: INVALID_ROLE_SCOPE', () => {
    const result = assign('HR', null);

    expect(!result.ok && result.error.code).toBe('INVALID_ROLE_SCOPE');
  });

  it.each(['DIRECT_MANAGER', 'EMPLOYEE'] as const)('%s: ROLE_NOT_ASSIGNABLE', (role) => {
    const result = assign(role, null);

    expect(!result.ok && result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });

  it('un rol no asignable se rechaza como tal aunque su alcance también sea inválido', () => {
    const result = assign('EMPLOYEE', COMPANY);

    expect(!result.ok && result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });
});

describe('RoleAssignment.grantSelf', () => {
  it('concede EMPLOYEE con la empresa del colaborador, assignedBy null y emite ROLE_ASSIGNED', () => {
    const assignment = RoleAssignment.grantSelf({
      id: ID,
      userId: USER,
      companyId: COMPANY,
      now: NOW,
    });

    expect(assignment.isActive).toBe(true);
    expect(assignment.snapshot).toEqual({
      userId: USER,
      role: 'EMPLOYEE',
      companyId: COMPANY,
      assignedAt: NOW,
      assignedBy: null,
      revokedAt: null,
      revokedBy: null,
    });
    const events = assignment.pullEvents();
    expect(events.map((event) => event.name)).toEqual([ROLE_ASSIGNED]);
    expect(events[0]?.payload).toMatchObject({ role: 'EMPLOYEE', companyId: COMPANY });
  });

  it('no abre la puerta a asignar EMPLOYEE a mano: assign sigue rechazándolo', () => {
    const result = assign('EMPLOYEE', COMPANY);

    expect(!result.ok && result.error.code).toBe('ROLE_NOT_ASSIGNABLE');
  });
});

describe('RoleAssignment.revoke', () => {
  it('registra quién y cuándo, deja de estar activa y emite ROLE_REVOKED', () => {
    const assignment = assigned();
    assignment.pullEvents();

    assignment.revoke(ADMIN, LATER);

    expect(assignment.isActive).toBe(false);
    expect(assignment.snapshot.revokedAt).toEqual(LATER);
    expect(assignment.snapshot.revokedBy).toBe(ADMIN);
    expect(assignment.pullEvents().map((event) => event.name)).toEqual([ROLE_REVOKED]);
  });

  it('es idempotente: revocar otra vez no cambia quién/cuándo ni emite otro evento', () => {
    const assignment = assigned();
    assignment.revoke(ADMIN, LATER);
    assignment.pullEvents();

    assignment.revoke('otro' as UserId, new Date('2026-02-01T00:00:00Z'));

    expect(assignment.snapshot.revokedAt).toEqual(LATER);
    expect(assignment.snapshot.revokedBy).toBe(ADMIN);
    expect(assignment.pullEvents()).toEqual([]);
  });
});

describe('RoleAssignment.restore', () => {
  it('rehidrata sin emitir eventos y respeta el estado de revocación', () => {
    const revoked = RoleAssignment.restore(ID, {
      userId: USER,
      role: 'HR',
      companyId: COMPANY,
      assignedAt: NOW,
      assignedBy: null,
      revokedAt: LATER,
      revokedBy: ADMIN,
    });

    expect(revoked.isActive).toBe(false);
    expect(revoked.pullEvents()).toEqual([]);
  });
});
