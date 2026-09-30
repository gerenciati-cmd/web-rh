import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { RoleAssignment, type RoleAssignmentId } from '@/modules/identity/domain/role-assignment';
import { User, type UserId } from '@/modules/identity/domain/user';
import { PrismaRoleAssignmentRepository } from '@/modules/identity/infrastructure/prisma-role-assignment.repository';
import { PrismaUserQueries } from '@/modules/identity/infrastructure/prisma-user.queries';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.role_assignments', 'identity.users']);
const queries = new PrismaUserQueries({ database });
const users = new PrismaUserRepository({ database });
const assignments = new PrismaRoleAssignmentRepository({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');
const COMPANY = '00000000-0000-4000-8000-0000000000c1';

async function seedUser(rawEmail: string): Promise<UserId> {
  const email = Email.create(rawEmail);
  if (!email.ok) throw email.error;
  const created = User.register({
    id: ids.next() as UserId,
    email: email.value,
    passwordHash: 'hash',
    now: NOW,
  });
  await users.save(created);
  return created.id;
}

async function seedAssignment(
  userId: UserId,
  role: 'HR' | 'HOLDING_ADMIN',
  companyId: string | null,
  at: Date,
): Promise<RoleAssignment> {
  const result = RoleAssignment.assign({
    id: ids.next() as RoleAssignmentId,
    userId,
    role,
    companyId,
    assignedBy: null,
    now: at,
  });
  if (!result.ok) throw result.error;
  await assignments.save(result.value);
  return result.value;
}

describe('PrismaUserQueries.listUsers', () => {
  it('lista ordenado por correo, con id, correo y estado, y total', async () => {
    await seedUser('zeta@aps.cl');
    await seedUser('ana@aps.cl');
    await seedUser('mario@aps.cl');

    const page = await queries.listUsers({ page: 1, pageSize: 20 });

    expect(page.total).toBe(3);
    expect(page.items.map((u) => u.email)).toEqual(['ana@aps.cl', 'mario@aps.cl', 'zeta@aps.cl']);
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      email: 'ana@aps.cl',
      status: 'ACTIVE',
    });
  });

  it('pagina: total sobre todo, items de la página pedida', async () => {
    await seedUser('a@aps.cl');
    await seedUser('b@aps.cl');
    await seedUser('c@aps.cl');

    const second = await queries.listUsers({ page: 2, pageSize: 2 });

    expect(second.total).toBe(3);
    expect(second.items.map((u) => u.email)).toEqual(['c@aps.cl']);
  });

  it('search filtra por correo sin distinguir mayúsculas y ajusta el total', async () => {
    await seedUser('ana.perez@aps.cl');
    await seedUser('luis@aps.cl');
    await seedUser('mariana@aps.cl');

    const page = await queries.listUsers({ page: 1, pageSize: 20, search: 'ANA' });

    expect(page.total).toBe(2);
    expect(page.items.map((u) => u.email)).toEqual(['ana.perez@aps.cl', 'mariana@aps.cl']);
  });

  it('search sin coincidencias: página vacía', async () => {
    await seedUser('ana@aps.cl');

    const page = await queries.listUsers({ page: 1, pageSize: 20, search: 'zzz' });

    expect(page).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
  });
});

describe('PrismaUserQueries.listActiveRoleAssignments', () => {
  it('devuelve null si el usuario no existe', async () => {
    expect(
      await queries.listActiveRoleAssignments('00000000-0000-4000-8000-999999999999'),
    ).toBeNull();
  });

  it('usuario sin asignaciones: lista vacía (distinto de null)', async () => {
    const userId = await seedUser('nada@aps.cl');

    expect(await queries.listActiveRoleAssignments(userId)).toEqual([]);
  });

  it('solo activas, con assignedAt en ISO y en orden de asignación', async () => {
    const userId = await seedUser('hr@aps.cl');
    const otherId = await seedUser('otro@aps.cl');
    const later = await seedAssignment(
      userId,
      'HOLDING_ADMIN',
      null,
      new Date('2026-02-01T00:00:00Z'),
    );
    const earlier = await seedAssignment(userId, 'HR', COMPANY, new Date('2026-01-01T00:00:00Z'));
    const revoked = await seedAssignment(userId, 'HR', '00000000-0000-4000-8000-0000000000c2', NOW);
    revoked.revoke(otherId, NOW);
    await assignments.save(revoked);
    await seedAssignment(otherId, 'HOLDING_ADMIN', null, NOW);

    const result = await queries.listActiveRoleAssignments(userId);

    expect(result).toEqual([
      { id: earlier.id, role: 'HR', companyId: COMPANY, assignedAt: '2026-01-01T00:00:00.000Z' },
      {
        id: later.id,
        role: 'HOLDING_ADMIN',
        companyId: null,
        assignedAt: '2026-02-01T00:00:00.000Z',
      },
    ]);
  });
});
