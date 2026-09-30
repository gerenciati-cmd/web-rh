import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { Session, SessionId } from '../domain/session';
import type { SessionRepository } from '../domain/session.repository';
import type { UserId } from '../domain/user';

import { SessionMapper } from './session.mapper';

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: SessionId): Promise<Session | null> {
    const row = await this.deps.database.client.session.findUnique({ where: { id } });
    return row ? SessionMapper.toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const row = await this.deps.database.client.session.findUnique({ where: { tokenHash } });
    return row ? SessionMapper.toDomain(row) : null;
  }

  async save(session: Session): Promise<void> {
    const data = SessionMapper.toPersistence(session);
    await this.deps.database.client.session.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }

  async revokeAllForUser(userId: UserId, now: Date): Promise<number> {
    const { count } = await this.deps.database.client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  async recordActivity(session: Session): Promise<void> {
    // `updateMany` (no `update`): con `revokedAt: null` en el WHERE, un logout concurrente que
    // ya revocó la fila hace que esto no toque nada, en vez de resucitarla con un `upsert` ciego.
    await this.deps.database.client.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { lastSeenAt: session.snapshot.lastSeenAt },
    });
  }
}
