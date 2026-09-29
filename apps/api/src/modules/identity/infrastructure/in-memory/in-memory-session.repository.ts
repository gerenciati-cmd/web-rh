import type { Session, SessionId } from '../../domain/session';
import type { SessionRepository } from '../../domain/session.repository';

export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, Session>();

  findById(id: SessionId): Promise<Session | null> {
    return Promise.resolve(this.sessions.get(id) ?? null);
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    const found = [...this.sessions.values()].find(
      (session) => session.snapshot.tokenHash === tokenHash,
    );
    return Promise.resolve(found ?? null);
  }

  save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
    return Promise.resolve();
  }
}
