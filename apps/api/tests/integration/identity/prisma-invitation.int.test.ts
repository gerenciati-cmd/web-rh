import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Invitation, type InvitationId } from '@/modules/identity/domain/invitation';
import type { UserId } from '@/modules/identity/domain/user';
import { PrismaInvitationRepository } from '@/modules/identity/infrastructure/prisma-invitation.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.invitations']);
const repository = new PrismaInvitationRepository({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');
const TTL_MS = 3_600_000;
const INVITER = '00000000-0000-4000-8000-0000000000aa' as UserId;
const EMPLOYEE = '00000000-0000-4000-8000-0000000000e1';
const COMPANY = '00000000-0000-4000-8000-0000000000c1';

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

let hashCounter = 0;
function invitation(
  overrides: { email?: string; employeeId?: string | null; ttlMs?: number } = {},
): Invitation {
  hashCounter += 1;
  const employeeId = overrides.employeeId === undefined ? EMPLOYEE : overrides.employeeId;
  return Invitation.issue({
    id: ids.next() as InvitationId,
    email: mustEmail(overrides.email ?? 'ana@aps.cl'),
    employeeId,
    companyId: employeeId === null ? null : COMPANY,
    tokenHash: String(hashCounter).padStart(64, '0'),
    invitedBy: INVITER,
    ttlMs: overrides.ttlMs ?? TTL_MS,
    now: NOW,
  });
}

async function mustFind(id: InvitationId): Promise<Invitation> {
  const found = await repository.findById(id);
  if (!found) throw new Error(`invitación ${id} no encontrada`);
  return found;
}

describe('PrismaInvitationRepository', () => {
  it('guarda y rehidrata todos los campos (invitedBy sin FK: el usuario no existe en la tabla)', async () => {
    const original = invitation();
    await repository.save(original);

    const found = await repository.findById(original.id);

    expect(found?.snapshot).toEqual(original.snapshot);
    expect(found?.snapshot.email.value).toBe('ana@aps.cl');
    expect(found?.snapshot.acceptedAt).toBeNull();
    expect(found?.snapshot.revokedAt).toBeNull();
  });

  it('una invitación externa guarda employeeId y companyId como null', async () => {
    const external = invitation({ employeeId: null, email: 'contador@externo.com' });
    await repository.save(external);

    const found = await repository.findById(external.id);

    expect(found?.snapshot).toMatchObject({ employeeId: null, companyId: null });
  });

  it('findById devuelve null si no existe', async () => {
    expect(await repository.findById('00000000-0000-4000-8000-999999999999' as InvitationId)).toBe(
      null,
    );
  });

  it('findByTokenHash encuentra por el hash exacto y devuelve null si no existe', async () => {
    const original = invitation();
    await repository.save(original);

    expect((await repository.findByTokenHash(original.snapshot.tokenHash))?.id).toBe(original.id);
    expect(await repository.findByTokenHash('f'.repeat(64))).toBeNull();
  });

  it('el hash del token es único: guardar otra invitación con el mismo hash falla', async () => {
    const first = invitation();
    await repository.save(first);
    const clash = Invitation.restore('00000000-0000-4000-8000-0000000000f1' as InvitationId, {
      ...invitation().snapshot,
      tokenHash: first.snapshot.tokenHash,
    });

    await expect(repository.save(clash)).rejects.toThrow();
  });

  it('save (upsert) persiste aceptar y reemplazar; la fila no se borra', async () => {
    const accepted = invitation();
    const superseded = invitation({ email: 'otra@aps.cl', employeeId: null });
    await repository.save(accepted);
    await repository.save(superseded);

    accepted.accept(NOW);
    superseded.supersede(NOW);
    await repository.save(accepted);
    await repository.save(superseded);

    expect((await repository.findById(accepted.id))?.snapshot.acceptedAt).toEqual(NOW);
    expect((await repository.findById(superseded.id))?.snapshot.revokedAt).toEqual(NOW);
    expect(await database.client.invitation.count()).toBe(2);
  });

  describe('save condicional (la decisión previa gana)', () => {
    it('devuelve true al crear y al actualizar una invitación aún pendiente', async () => {
      const original = invitation();

      expect(await repository.save(original)).toBe(true);
      original.supersede(NOW);

      expect(await repository.save(original)).toBe(true);
    });

    it('una invitación ya aceptada en la base no se sobrescribe: devuelve false', async () => {
      const original = invitation();
      await repository.save(original);
      const accepted = await mustFind(original.id);
      const stale = await mustFind(original.id);
      accepted.accept(NOW);
      await repository.save(accepted);

      stale.supersede(new Date(NOW.getTime() + 1000));
      const saved = await repository.save(stale);

      expect(saved).toBe(false);
      expect((await mustFind(original.id)).snapshot).toMatchObject({
        acceptedAt: NOW,
        revokedAt: null,
      });
    });

    it('una invitación ya reemplazada en la base no se revive al aceptar: devuelve false', async () => {
      const original = invitation();
      await repository.save(original);
      const superseding = await mustFind(original.id);
      const stale = await mustFind(original.id);
      superseding.supersede(NOW);
      await repository.save(superseding);

      stale.accept(new Date(NOW.getTime() + 1000));
      const saved = await repository.save(stale);

      expect(saved).toBe(false);
      expect((await mustFind(original.id)).snapshot).toMatchObject({
        acceptedAt: null,
        revokedAt: NOW,
      });
    });

    it('aceptar y reemplazar a la vez: solo una escritura gana y la fila queda con una sola marca', async () => {
      const original = invitation();
      await repository.save(original);
      const accepting = await mustFind(original.id);
      const superseding = await mustFind(original.id);
      accepting.accept(NOW);
      superseding.supersede(NOW);

      const results = await Promise.all([repository.save(accepting), repository.save(superseding)]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const { acceptedAt, revokedAt } = (await mustFind(original.id)).snapshot;
      expect([acceptedAt, revokedAt].filter((mark) => mark !== null)).toHaveLength(1);
    });
  });

  describe('findPendingForEmployee', () => {
    it('devuelve solo las pendientes del colaborador', async () => {
      const pending = invitation();
      const accepted = invitation();
      accepted.accept(NOW);
      const superseded = invitation();
      superseded.supersede(NOW);
      const expired = invitation({ ttlMs: 1000 });
      const foreign = invitation({ employeeId: '00000000-0000-4000-8000-0000000000e2' });
      for (const each of [pending, accepted, superseded, expired, foreign]) {
        await repository.save(each);
      }

      const found = await repository.findPendingForEmployee(
        EMPLOYEE,
        new Date(NOW.getTime() + 5000),
      );

      expect(found.map((i) => i.id)).toEqual([pending.id]);
    });

    it('expiresAt es exclusivo: en el instante exacto de vencimiento ya no está pendiente', async () => {
      const original = invitation();
      await repository.save(original);

      const before = await repository.findPendingForEmployee(
        EMPLOYEE,
        new Date(NOW.getTime() + TTL_MS - 1),
      );
      const atExpiry = await repository.findPendingForEmployee(
        EMPLOYEE,
        new Date(NOW.getTime() + TTL_MS),
      );

      expect(before).toHaveLength(1);
      expect(atExpiry).toEqual([]);
    });
  });

  describe('findPendingForEmail', () => {
    it('devuelve solo las pendientes de ese correo, sin importar el colaborador', async () => {
      const forEmployee = invitation({ email: 'comun@aps.cl' });
      const external = invitation({ email: 'comun@aps.cl', employeeId: null });
      const otherEmail = invitation({ email: 'otro@aps.cl' });
      const superseded = invitation({ email: 'comun@aps.cl' });
      superseded.supersede(NOW);
      for (const each of [forEmployee, external, otherEmail, superseded]) {
        await repository.save(each);
      }

      const found = await repository.findPendingForEmail(mustEmail('comun@aps.cl'), NOW);

      expect(found.map((i) => i.id).sort()).toEqual([forEmployee.id, external.id].sort());
    });
  });
});
