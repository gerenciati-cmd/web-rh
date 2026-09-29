import { Session, type SessionId } from '../../domain/session';
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

  /** Actualiza solo `lastSeenAt` de la fila guardada, y solo si esa fila sigue sin revocar
   *  (H2) — reconstruye la sesión en vez de reusar la referencia recibida, para no arrastrar
   *  ningún otro cambio que el llamador pueda tener pendiente en su propia copia. */
  recordActivity(session: Session): Promise<void> {
    const stored = this.sessions.get(session.id);
    if (stored?.snapshot.revokedAt !== null) return Promise.resolve();
    this.sessions.set(
      session.id,
      Session.restore(session.id, { ...stored.snapshot, lastSeenAt: session.snapshot.lastSeenAt }),
    );
    return Promise.resolve();
  }
}
