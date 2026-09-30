import { Email, type Role } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { RoleAssignment, type RoleAssignmentId } from '@/modules/identity/domain/role-assignment';
import { User, type UserId } from '@/modules/identity/domain/user';
import { PrismaRoleAssignmentRepository } from '@/modules/identity/infrastructure/prisma-role-assignment.repository';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.role_assignments', 'identity.users']);
const assignments = new PrismaRoleAssignmentRepository({ database });
const users = new PrismaUserRepository({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');
const LATER = new Date('2026-01-16T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

/** role_assignments tiene FK a users (mismo schema): se siembra el usuario primero. */
async function seedUser(rawEmail: string): Promise<UserId> {
  const created = User.register({
    id: ids.next() as UserId,
    email: mustEmail(rawEmail),
    passwordHash: 'hash',
    now: NOW,
  });
  await users.save(created);
  return created.id;
}

function assignment(
  userId: UserId,
  role: Role,
  companyId: string | null,
  assignedBy: UserId | null = null,
): RoleAssignment {
  const result = RoleAssignment.assign({
    id: ids.next() as RoleAssignmentId,
    userId,
    role,
    companyId,
    assignedBy,
    now: NOW,
  });
  if (!result.ok) throw result.error;
  return result.value;
}

describe('PrismaRoleAssignmentRepository', () => {
  it('guarda y rehidrata la asignación, con companyId y assignedBy nulos', async () => {
    const userId = await seedUser('admin@aps.cl');
    const admin = assignment(userId, 'HOLDING_ADMIN', null, null);
    await assignments.save(admin);

    const found = await assignments.findById(admin.id);

    expect(found?.snapshot).toEqual({
      userId,
      role: 'HOLDING_ADMIN',
      companyId: null,
      assignedAt: NOW,
      assignedBy: null,
      revokedAt: null,
      revokedBy: null,
    });
  });

  it('guarda el companyId (sin FK: es un id de otro módulo) y quién asignó', async () => {
    const userId = await seedUser('hr@aps.cl');
    const adminId = await seedUser('admin@aps.cl');
    const hr = assignment(userId, 'HR', COMPANY, adminId);
    await assignments.save(hr);

    const found = await assignments.findById(hr.id);

    expect(found?.snapshot.companyId).toBe(COMPANY);
    expect(found?.snapshot.assignedBy).toBe(adminId);
  });

  it('findById devuelve null si no existe', async () => {
    expect(await assignments.findById('00000000-0000-4000-8000-999999999999' as never)).toBeNull();
  });

  it('save (upsert) persiste la revocación como historial: la fila no se borra', async () => {
    const userId = await seedUser('hr@aps.cl');
    const adminId = await seedUser('admin@aps.cl');
    const hr = assignment(userId, 'HR', COMPANY);
    await assignments.save(hr);

    hr.revoke(adminId, LATER);
    await assignments.save(hr);

    const found = await assignments.findById(hr.id);
    expect(found?.snapshot.revokedAt).toEqual(LATER);
    expect(found?.snapshot.revokedBy).toBe(adminId);
    expect(found?.isActive).toBe(false);
  });

  it('findActiveByUser devuelve solo las activas de ese usuario, en orden de asignación', async () => {
    const userId = await seedUser('hr@aps.cl');
    const otherId = await seedUser('otro@aps.cl');
    const first = assignment(userId, 'HR', COMPANY);
    const revoked = assignment(userId, 'HR', '00000000-0000-4000-8000-0000000000c2');
    revoked.revoke(otherId, LATER);
    const foreign = assignment(otherId, 'HOLDING_ADMIN', null);
    await assignments.save(first);
    await assignments.save(revoked);
    await assignments.save(foreign);

    const active = await assignments.findActiveByUser(userId);

    expect(active.map((a) => a.id)).toEqual([first.id]);
  });

  it('findActiveByUser de un usuario sin asignaciones: lista vacía', async () => {
    const userId = await seedUser('nada@aps.cl');

    expect(await assignments.findActiveByUser(userId)).toEqual([]);
  });

  it('countActiveByRole cuenta solo activas de ese rol', async () => {
    const a = await seedUser('a@aps.cl');
    const b = await seedUser('b@aps.cl');
    const c = await seedUser('c@aps.cl');
    await assignments.save(assignment(a, 'HOLDING_ADMIN', null));
    const revokedAdmin = assignment(b, 'HOLDING_ADMIN', null);
    revokedAdmin.revoke(a, LATER);
    await assignments.save(revokedAdmin);
    await assignments.save(assignment(c, 'HR', COMPANY));

    expect(await assignments.countActiveByRole('HOLDING_ADMIN')).toBe(1);
    expect(await assignments.countActiveByRole('HR')).toBe(1);
    expect(await assignments.countActiveByRole('EMPLOYEE')).toBe(0);
  });
});
