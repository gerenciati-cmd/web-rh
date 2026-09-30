import { Email, type Role } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import { AssignRole } from '@/modules/identity/application/commands/assign-role.command';
import type { CompanyDirectory } from '@/modules/identity/application/ports/company-directory';
import { RoleAssignment, type RoleAssignmentId } from '@/modules/identity/domain/role-assignment';
import { User, type UserId } from '@/modules/identity/domain/user';
import { PrismaRoleAssignmentRepository } from '@/modules/identity/infrastructure/prisma-role-assignment.repository';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { FixedClock, RecordingEventBus, SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.role_assignments', 'identity.users']);
const assignments = new PrismaRoleAssignmentRepository({ database });
const users = new PrismaUserRepository({ database });
const transactionRunner = new PrismaTransactionRunner({ database });
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

  describe('lockUser', () => {
    it('true si el usuario existe, false si no', async () => {
      const userId = await seedUser('lock@aps.cl');

      expect(await transactionRunner.run(() => assignments.lockUser(userId))).toBe(true);
      expect(
        await transactionRunner.run(() =>
          assignments.lockUser('00000000-0000-4000-8000-999999999999' as UserId),
        ),
      ).toBe(false);
    });
  });

  // R4 contra Postgres real: sin el `FOR UPDATE` sobre el usuario, las dos ejecuciones pasarían
  // a la vez la comprobación de duplicado y quedarían dos filas activas.
  describe('AssignRole concurrente (R4)', () => {
    const noCompanies: CompanyDirectory = {
      find: (id) => Promise.resolve({ id, active: true }),
    };
    const assignRole = new AssignRole({
      userRepository: users,
      roleAssignmentRepository: {
        findById: (id) => assignments.findById(id),
        // Pausa tras leer para ensanchar la ventana de carrera: sin el bloqueo, ambas ejecuciones
        // leerían "sin duplicado" antes de que cualquiera guarde.
        findActiveByUser: async (id) => {
          const active = await assignments.findActiveByUser(id);
          await new Promise((resolve) => setTimeout(resolve, 100));
          return active;
        },
        countActiveByRole: (r) => assignments.countActiveByRole(r),
        save: (a) => assignments.save(a),
        lockUser: (id) => assignments.lockUser(id),
      },
      companyDirectory: noCompanies,
      idGenerator: ids,
      transactionRunner,
      clock: new FixedClock(NOW),
      eventBus: new RecordingEventBus(),
    });

    it('dos asignaciones idénticas en paralelo: una fila activa y la otra ROLE_ALREADY_ASSIGNED', async () => {
      const userId = await seedUser('paralelo@aps.cl');
      const input = { userId, role: 'HR' as const, companyId: COMPANY, assignedBy: null };

      const results = await Promise.all([assignRole.execute(input), assignRole.execute(input)]);

      expect(results.filter((r) => r.ok)).toHaveLength(1);
      const codes = results.flatMap((r) => (r.ok ? [] : [r.error.code]));
      expect(codes).toEqual(['ROLE_ALREADY_ASSIGNED']);
      expect(await assignments.findActiveByUser(userId)).toHaveLength(1);
      expect(await database.client.roleAssignment.count({ where: { userId } })).toBe(1);
    });

    it('asignaciones distintas del mismo usuario en paralelo: ambas se guardan', async () => {
      const userId = await seedUser('paralelo2@aps.cl');
      const other = '00000000-0000-4000-8000-0000000000c2';

      const results = await Promise.all([
        assignRole.execute({ userId, role: 'HR', companyId: COMPANY, assignedBy: null }),
        assignRole.execute({ userId, role: 'HR', companyId: other, assignedBy: null }),
      ]);

      expect(results.every((r) => r.ok)).toBe(true);
      expect(await assignments.findActiveByUser(userId)).toHaveLength(2);
    });

    it('usuario inexistente: USER_NOT_FOUND sin filas', async () => {
      const result = await assignRole.execute({
        userId: '00000000-0000-4000-8000-999999999999',
        role: 'HR',
        companyId: COMPANY,
        assignedBy: null,
      });

      expect(!result.ok && result.error.code).toBe('USER_NOT_FOUND');
      expect(await database.client.roleAssignment.count()).toBe(0);
    });
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
