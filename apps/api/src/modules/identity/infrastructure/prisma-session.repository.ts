import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { Session, SessionId } from '../domain/session';
import type { SessionRepository } from '../domain/session.repository';

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
}
