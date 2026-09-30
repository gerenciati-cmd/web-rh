import { Email } from '@rrhh/domain';
import { beforeEach, describe, expect, it } from 'vitest';

import { PrismaTransactionRunner } from '@/infrastructure/database/prisma-transaction-runner';
import { PasswordResetIssuer } from '@/modules/identity/application/password-reset-issuer';
import { PasswordReset, type PasswordResetId } from '@/modules/identity/domain/password-reset';
import { User, type UserId } from '@/modules/identity/domain/user';
import { CryptoPasswordResetTokens } from '@/modules/identity/infrastructure/crypto-password-reset-tokens';
import { PrismaPasswordResetRepository } from '@/modules/identity/infrastructure/prisma-password-reset.repository';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import {
  FixedClock,
  RecordingEventBus,
  RecordingJobQueue,
  SequentialIdGenerator,
} from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase([
  'identity.password_resets',
  'identity.sessions',
  'identity.users',
]);
const repository = new PrismaPasswordResetRepository({ database });
const users = new PrismaUserRepository({ database });
const transactionRunner = new PrismaTransactionRunner({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');
const TTL_MS = 3_600_000;
const STAFF = '00000000-0000-4000-8000-0000000000aa' as UserId;

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

async function seedUser(rawEmail = 'ana@aps.cl'): Promise<User> {
  const user = User.register({
    id: ids.next() as UserId,
    email: mustEmail(rawEmail),
    passwordHash: 'hash-de-prueba',
    now: NOW,
  });
  const saved = await users.save(user);
  if (!saved.ok) throw saved.error;
  return user;
}

let hashCounter = 0;
function reset(userId: UserId, overrides: { ttlMs?: number; requestedBy?: UserId | null } = {}) {
  hashCounter += 1;
  return PasswordReset.issue({
    id: ids.next() as PasswordResetId,
    userId,
    tokenHash: String(hashCounter).padStart(64, '0'),
    requestedBy: overrides.requestedBy === undefined ? null : overrides.requestedBy,
    ttlMs: overrides.ttlMs ?? TTL_MS,
    now: NOW,
  });
}

async function mustFind(tokenHash: string): Promise<PasswordReset> {
  const found = await repository.findByTokenHash(tokenHash);
  if (!found) throw new Error('restablecimiento no encontrado');
  return found;
}

describe('PrismaPasswordResetRepository', () => {
  let ana: User;

  beforeEach(async () => {
    ana = await seedUser();
  });

  it('guarda y rehidrata todos los campos, incluido requestedBy (sin FK)', async () => {
    const forced = reset(ana.id, { requestedBy: STAFF });
    await repository.save(forced);

    const found = await repository.findByTokenHash(forced.snapshot.tokenHash);

    expect(found?.id).toBe(forced.id);
    expect(found?.snapshot).toEqual(forced.snapshot);
    expect(found?.snapshot.requestedBy).toBe(STAFF);
  });

  it('requestedBy null se conserva como null', async () => {
    const own = reset(ana.id);
    await repository.save(own);

    expect((await mustFind(own.snapshot.tokenHash)).snapshot.requestedBy).toBeNull();
  });

  it('findByTokenHash devuelve null si no existe', async () => {
    expect(await repository.findByTokenHash('f'.repeat(64))).toBeNull();
  });

  it('el hash del token es único: guardar otro restablecimiento con el mismo hash falla', async () => {
    const first = reset(ana.id);
    await repository.save(first);
    const clash = PasswordReset.restore(ids.next() as PasswordResetId, {
      ...reset(ana.id).snapshot,
      tokenHash: first.snapshot.tokenHash,
    });

    await expect(repository.save(clash)).rejects.toThrow();
  });

  it('la clave foránea exige un usuario existente', async () => {
    const orphan = reset('00000000-0000-4000-8000-00000000dead' as UserId);

    await expect(repository.save(orphan)).rejects.toThrow();
  });

  it('save persiste usar y reemplazar; la fila no se borra', async () => {
    const used = reset(ana.id);
    const superseded = reset(ana.id);
    await repository.save(used);
    await repository.save(superseded);

    used.use(NOW);
    superseded.supersede(NOW);
    await repository.save(used);
    await repository.save(superseded);

    expect((await mustFind(used.snapshot.tokenHash)).snapshot.usedAt).toEqual(NOW);
    expect((await mustFind(superseded.snapshot.tokenHash)).snapshot.revokedAt).toEqual(NOW);
    expect(await database.client.passwordReset.count()).toBe(2);
  });

  describe('save condicional (la decisión previa gana)', () => {
    it('devuelve true al crear y al actualizar uno aún pendiente', async () => {
      const original = reset(ana.id);

      expect(await repository.save(original)).toBe(true);
      original.supersede(NOW);

      expect(await repository.save(original)).toBe(true);
    });

    it('uno ya usado en la base no se sobrescribe: devuelve false', async () => {
      const original = reset(ana.id);
      await repository.save(original);
      const used = await mustFind(original.snapshot.tokenHash);
      const stale = await mustFind(original.snapshot.tokenHash);
      used.use(NOW);
      await repository.save(used);

      stale.supersede(new Date(NOW.getTime() + 1000));
      const saved = await repository.save(stale);

      expect(saved).toBe(false);
      expect((await mustFind(original.snapshot.tokenHash)).snapshot).toMatchObject({
        usedAt: NOW,
        revokedAt: null,
      });
    });

    it('uno ya reemplazado en la base no se revive al usar: devuelve false', async () => {
      const original = reset(ana.id);
      await repository.save(original);
      const superseding = await mustFind(original.snapshot.tokenHash);
      const stale = await mustFind(original.snapshot.tokenHash);
      superseding.supersede(NOW);
      await repository.save(superseding);

      stale.use(new Date(NOW.getTime() + 1000));
      const saved = await repository.save(stale);

      expect(saved).toBe(false);
      expect((await mustFind(original.snapshot.tokenHash)).snapshot).toMatchObject({
        usedAt: null,
        revokedAt: NOW,
      });
    });

    it('usar y reemplazar a la vez: solo una escritura gana y la fila queda con una sola marca', async () => {
      const original = reset(ana.id);
      await repository.save(original);
      const using = await mustFind(original.snapshot.tokenHash);
      const superseding = await mustFind(original.snapshot.tokenHash);
      using.use(NOW);
      superseding.supersede(NOW);

      const results = await Promise.all([repository.save(using), repository.save(superseding)]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const { usedAt, revokedAt } = (await mustFind(original.snapshot.tokenHash)).snapshot;
      expect([usedAt, revokedAt].filter((mark) => mark !== null)).toHaveLength(1);
    });
  });

  describe('findPendingForUser', () => {
    it('devuelve solo los pendientes del usuario', async () => {
      const other = await seedUser('otra@aps.cl');
      const pending = reset(ana.id);
      const used = reset(ana.id);
      used.use(NOW);
      const superseded = reset(ana.id);
      superseded.supersede(NOW);
      const expired = reset(ana.id, { ttlMs: 1000 });
      const foreign = reset(other.id);
      for (const each of [pending, used, superseded, expired, foreign]) {
        await repository.save(each);
      }

      const found = await repository.findPendingForUser(ana.id, new Date(NOW.getTime() + 5000));

      expect(found.map((r) => r.id)).toEqual([pending.id]);
    });

    it('expiresAt es exclusivo: en el instante exacto de vencimiento ya no está pendiente', async () => {
      await repository.save(reset(ana.id));

      const before = await repository.findPendingForUser(
        ana.id,
        new Date(NOW.getTime() + TTL_MS - 1),
      );
      const atExpiry = await repository.findPendingForUser(
        ana.id,
        new Date(NOW.getTime() + TTL_MS),
      );

      expect(before).toHaveLength(1);
      expect(atExpiry).toEqual([]);
    });
  });
});

describe('PrismaPasswordResetRepository + PasswordResetIssuer: solicitudes concurrentes', () => {
  it('dos solicitudes simultáneas del mismo usuario dejan exactamente un restablecimiento pendiente', async () => {
    const ana = await seedUser();
    const clock = new FixedClock(NOW);
    const issuer = new PasswordResetIssuer({
      passwordResetRepository: repository,
      userRepository: users,
      passwordResetTokens: new CryptoPasswordResetTokens(),
      passwordResetPolicy: {
        ttlMs: TTL_MS,
        cooldownMs: 180_000,
        appPublicUrl: 'https://rrhh.example.test',
      },
      idGenerator: ids,
      transactionRunner,
      clock,
      eventBus: new RecordingEventBus(),
      jobQueue: new RecordingJobQueue(),
    });

    await Promise.all(
      Array.from({ length: 4 }, () =>
        issuer.issue({ user: ana, requestedBy: STAFF, respectCooldown: false }),
      ),
    );

    expect(await repository.findPendingForUser(ana.id, NOW)).toHaveLength(1);
    expect(await database.client.passwordReset.count()).toBe(4);
  });

  it('con cooldown, solicitudes simultáneas del usuario crean un solo restablecimiento', async () => {
    const ana = await seedUser();
    const jobQueue = new RecordingJobQueue();
    const issuer = new PasswordResetIssuer({
      passwordResetRepository: repository,
      userRepository: users,
      passwordResetTokens: new CryptoPasswordResetTokens(),
      passwordResetPolicy: {
        ttlMs: TTL_MS,
        cooldownMs: 180_000,
        appPublicUrl: 'https://rrhh.example.test',
      },
      idGenerator: ids,
      transactionRunner,
      clock: new FixedClock(NOW),
      eventBus: new RecordingEventBus(),
      jobQueue,
    });

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        issuer.issue({ user: ana, requestedBy: null, respectCooldown: true }),
      ),
    );

    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await database.client.passwordReset.count()).toBe(1);
    expect(jobQueue.jobs).toHaveLength(1);
  });
});
