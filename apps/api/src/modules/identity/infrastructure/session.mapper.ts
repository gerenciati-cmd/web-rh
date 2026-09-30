import type { Session as SessionRow } from '@/infrastructure/database/generated/client';

import { Session, type SessionId } from '../domain/session';
import type { UserId } from '../domain/user';

const MS_PER_SECOND = 1_000;
/** `user_agent` es `@db.VarChar(500)`: un valor más largo se recorta antes de guardar. */
const USER_AGENT_MAX_LENGTH = 500;

export const SessionMapper = {
  toDomain(row: SessionRow): Session {
    return Session.restore(row.id as SessionId, {
      userId: row.userId as UserId,
      tokenHash: row.tokenHash,
      client: row.client,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
      expiresAt: row.expiresAt,
      idleTimeoutMs:
        row.idleTimeoutSeconds === null ? null : row.idleTimeoutSeconds * MS_PER_SECOND,
      revokedAt: row.revokedAt,
      ip: row.ip,
      userAgent: row.userAgent,
    });
  },

  toPersistence(session: Session) {
    const s = session.snapshot;
    return {
      id: session.id,
      userId: s.userId,
      tokenHash: s.tokenHash,
      client: s.client,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      expiresAt: s.expiresAt,
      idleTimeoutSeconds:
        s.idleTimeoutMs === null ? null : Math.floor(s.idleTimeoutMs / MS_PER_SECOND),
      revokedAt: s.revokedAt,
      ip: s.ip,
      userAgent: s.userAgent === null ? null : s.userAgent.slice(0, USER_AGENT_MAX_LENGTH),
    };
  },
};
