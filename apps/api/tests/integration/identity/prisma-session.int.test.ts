import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { Session, type SessionId } from '@/modules/identity/domain/session';
import { User, type UserId } from '@/modules/identity/domain/user';
import { PrismaSessionRepository } from '@/modules/identity/infrastructure/prisma-session.repository';
import { PrismaUserRepository } from '@/modules/identity/infrastructure/prisma-user.repository';
import { SequentialIdGenerator } from '@/shared/testing/fakes';

import { useTestDatabase } from '../support';

const database = useTestDatabase(['identity.sessions', 'identity.users']);
const sessions = new PrismaSessionRepository({ database });
const users = new PrismaUserRepository({ database });
const ids = new SequentialIdGenerator();
const NOW = new Date('2026-01-15T12:00:00Z');

function mustEmail(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

/** Session tiene FK a User (misma manera que ADR 0010 permite dentro de un módulo). */
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

describe('PrismaSessionRepository', () => {
  it('guarda y rehidrata la sesión, incluyendo el timeout de inactividad en segundos', async () => {
    const userId = await seedUser('sesion1@aps.cl');
    const session = Session.start({
      id: ids.next() as SessionId,
      userId,
      tokenHash: 'a'.repeat(64),
      client: 'WEB',
      lifetime: { absoluteMs: 12 * 3_600_000, idleMs: 30 * 60_000 },
      now: NOW,
      ip: '10.0.0.1',
      userAgent: 'vitest',
    });
    await sessions.save(session);

    const found = await sessions.findById(session.id);

    expect(found?.snapshot.userId).toBe(userId);
    expect(found?.snapshot.idleTimeoutMs).toBe(30 * 60_000);
    expect(found?.snapshot.expiresAt).toEqual(session.snapshot.expiresAt);
    expect(found?.snapshot.ip).toBe('10.0.0.1');
    expect(found?.snapshot.userAgent).toBe('vitest');
  });

  it('idleTimeoutMs null (mobile) se guarda y rehidrata como null', async () => {
    const userId = await seedUser('sesion2@aps.cl');
    const session = Session.start({
      id: ids.next() as SessionId,
      userId,
      tokenHash: 'b'.repeat(64),
      client: 'MOBILE',
      lifetime: { absoluteMs: 30 * 86_400_000, idleMs: null },
      now: NOW,
      ip: null,
      userAgent: null,
    });
    await sessions.save(session);

    expect((await sessions.findById(session.id))?.snapshot.idleTimeoutMs).toBeNull();
  });

  it('findByTokenHash encuentra por el hash exacto y devuelve null si no existe', async () => {
    const userId = await seedUser('sesion3@aps.cl');
    const session = Session.start({
      id: ids.next() as SessionId,
      userId,
      tokenHash: 'c'.repeat(64),
      client: 'WEB',
      lifetime: { absoluteMs: 3_600_000, idleMs: null },
      now: NOW,
      ip: null,
      userAgent: null,
    });
    await sessions.save(session);

    expect((await sessions.findByTokenHash('c'.repeat(64)))?.id).toBe(session.id);
    expect(await sessions.findByTokenHash('d'.repeat(64))).toBeNull();
  });

  it('save (upsert) persiste la revocación', async () => {
    const userId = await seedUser('sesion4@aps.cl');
    const session = Session.start({
      id: ids.next() as SessionId,
      userId,
      tokenHash: 'e'.repeat(64),
      client: 'WEB',
      lifetime: { absoluteMs: 3_600_000, idleMs: null },
      now: NOW,
      ip: null,
      userAgent: null,
    });
    await sessions.save(session);

    const revokedAt = new Date(NOW.getTime() + 1000);
    session.revoke(revokedAt);
    await sessions.save(session);

    expect((await sessions.findById(session.id))?.snapshot.revokedAt).toEqual(revokedAt);
  });

  it('trunca el user agent a 500 caracteres antes de guardar', async () => {
    const userId = await seedUser('sesion5@aps.cl');
    const session = Session.start({
      id: ids.next() as SessionId,
      userId,
      tokenHash: 'f'.repeat(64),
      client: 'WEB',
      lifetime: { absoluteMs: 3_600_000, idleMs: null },
      now: NOW,
      ip: null,
      userAgent: 'x'.repeat(600),
    });
    await sessions.save(session);

    expect((await sessions.findById(session.id))?.snapshot.userAgent).toHaveLength(500);
  });

  // recordActivity (H2, plan 001 paso 15): un `upsert` con el snapshot completo podía, en una
  // carrera con un logout concurrente, volver a poner `revoked_at` en null. El `updateMany` con
  // `revokedAt: null` en el WHERE debe no tocar nada si la fila ya está revocada en la BD.
  describe('recordActivity', () => {
    it('no revive una sesión que ya quedó revocada en la BD (logout concurrente)', async () => {
      const userId = await seedUser('sesion6@aps.cl');
      const session = Session.start({
        id: ids.next() as SessionId,
        userId,
        tokenHash: 'g'.repeat(64),
        client: 'WEB',
        lifetime: { absoluteMs: 3_600_000, idleMs: 30 * 60_000 },
        now: NOW,
        ip: null,
        userAgent: null,
      });
      await sessions.save(session);

      // Otra "petición" carga su propia copia de la fila y la revoca (logout).
      const loadedByLogout = await sessions.findById(session.id);
      if (!loadedByLogout) throw new Error('fixture: sesión no encontrada');
      loadedByLogout.revoke(new Date(NOW.getTime() + 30_000));
      await sessions.save(loadedByLogout);

      // La instancia original, todavía con `revokedAt: null` en memoria, llega tarde a tocar.
      session.touch(new Date(NOW.getTime() + 61_000));
      await sessions.recordActivity(session);

      const found = await sessions.findById(session.id);
      expect(found?.snapshot.revokedAt).toEqual(loadedByLogout.snapshot.revokedAt);
      expect(found?.snapshot.lastSeenAt).toEqual(loadedByLogout.snapshot.lastSeenAt);
    });

    it('actualiza lastSeenAt cuando la sesión sigue activa', async () => {
      const userId = await seedUser('sesion7@aps.cl');
      const session = Session.start({
        id: ids.next() as SessionId,
        userId,
        tokenHash: 'h'.repeat(64),
        client: 'WEB',
        lifetime: { absoluteMs: 3_600_000, idleMs: 30 * 60_000 },
        now: NOW,
        ip: null,
        userAgent: null,
      });
      await sessions.save(session);

      const later = new Date(NOW.getTime() + 61_000);
      session.touch(later);
      await sessions.recordActivity(session);

      const found = await sessions.findById(session.id);
      expect(found?.snapshot.lastSeenAt).toEqual(later);
      expect(found?.snapshot.revokedAt).toBeNull();
    });
  });
});
