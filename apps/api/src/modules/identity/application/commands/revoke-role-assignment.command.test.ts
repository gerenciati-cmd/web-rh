import type { Role } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import type { TransactionRunner } from '@/shared/application/ports';
import { FixedClock, RecordingEventBus } from '@/shared/testing/fakes';

import { ROLE_REVOKED, RoleAssignment, type RoleAssignmentId } from '../../domain/role-assignment';
import type { UserId } from '../../domain/user';
import { InMemoryRoleAssignmentRepository } from '../../infrastructure/in-memory/in-memory-role-assignment.repository';

import { RevokeRoleAssignment } from './revoke-role-assignment.command';

/** Sin BD real, `run` solo ejecuta el trabajo. */
class NoopTransactionRunner implements TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
}

const NOW = new Date('2026-01-15T12:00:00Z');
const USER = 'user-1' as UserId;
const OTHER_USER = 'user-2' as UserId;
const REVOKER = 'user-admin';

describe('RevokeRoleAssignment', () => {
  let repository: InMemoryRoleAssignmentRepository;
  let eventBus: RecordingEventBus;
  let revoke: RevokeRoleAssignment;

  beforeEach(() => {
    repository = new InMemoryRoleAssignmentRepository();
    eventBus = new RecordingEventBus();
    revoke = new RevokeRoleAssignment({
      roleAssignmentRepository: repository,
      transactionRunner: new NoopTransactionRunner(),
      clock: new FixedClock(NOW),
      eventBus,
    });
  });

  function seed(id: string, userId: UserId, role: Role, companyId: string | null) {
    const result = RoleAssignment.assign({
      id: id as RoleAssignmentId,
      userId,
      role,
      companyId,
      assignedBy: null,
      now: NOW,
    });
    if (!result.ok) throw result.error;
    result.value.pullEvents();
    repository.assignments.set(id, result.value);
    return result.value;
  }

  it('revoca la asignación: guarda revokedAt/revokedBy y publica ROLE_REVOKED', async () => {
    seed('a1', USER, 'HR', 'company-a');

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(result.ok).toBe(true);
    expect(repository.assignments.get('a1')?.snapshot).toMatchObject({
      revokedAt: NOW,
      revokedBy: REVOKER,
    });
    expect(repository.assignments.get('a1')?.isActive).toBe(false);
    expect(eventBus.names()).toEqual([ROLE_REVOKED]);
  });

  it('asignación inexistente: ROLE_ASSIGNMENT_NOT_FOUND', async () => {
    const result = await revoke.execute({ userId: USER, assignmentId: 'nada', revokedBy: REVOKER });

    expect(!result.ok && result.error.code).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
    expect(eventBus.published).toEqual([]);
  });

  it('asignación de otro usuario: ROLE_ASSIGNMENT_NOT_FOUND y no se toca', async () => {
    seed('a1', OTHER_USER, 'HR', 'company-a');

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(!result.ok && result.error.code).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
    expect(repository.assignments.get('a1')?.isActive).toBe(true);
  });

  it('asignación ya revocada: ROLE_ASSIGNMENT_NOT_FOUND', async () => {
    const assignment = seed('a1', USER, 'HR', 'company-a');
    assignment.revoke(REVOKER as UserId, NOW);

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(!result.ok && result.error.code).toBe('ROLE_ASSIGNMENT_NOT_FOUND');
  });

  it('el único HOLDING_ADMIN activo: LAST_HOLDING_ADMIN y sigue activo', async () => {
    seed('a1', USER, 'HOLDING_ADMIN', null);

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(!result.ok && result.error.code).toBe('LAST_HOLDING_ADMIN');
    expect(repository.assignments.get('a1')?.isActive).toBe(true);
    expect(eventBus.published).toEqual([]);
  });

  it('con otro HOLDING_ADMIN activo se puede revocar uno', async () => {
    seed('a1', USER, 'HOLDING_ADMIN', null);
    seed('a2', OTHER_USER, 'HOLDING_ADMIN', null);

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(result.ok).toBe(true);
    expect(repository.assignments.get('a1')?.isActive).toBe(false);
  });

  it('un HOLDING_ADMIN ya revocado no cuenta como "otro" administrador', async () => {
    seed('a1', USER, 'HOLDING_ADMIN', null);
    seed('a2', OTHER_USER, 'HOLDING_ADMIN', null).revoke(REVOKER as UserId, NOW);

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(!result.ok && result.error.code).toBe('LAST_HOLDING_ADMIN');
  });

  it('la regla del último administrador no aplica a HR', async () => {
    seed('a1', USER, 'HR', 'company-a');

    const result = await revoke.execute({ userId: USER, assignmentId: 'a1', revokedBy: REVOKER });

    expect(result.ok).toBe(true);
  });
});
