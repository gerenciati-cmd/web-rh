import type { Session, SessionId } from './session';
import type { UserId } from './user';

export interface SessionRepository {
  findById(id: SessionId): Promise<Session | null>;
  findByTokenHash(tokenHash: string): Promise<Session | null>;
  save(session: Session): Promise<void>;
  /**
   * Persiste solo `lastSeenAt`, y solo si la sesión sigue sin revocar (H2): un `save` con el
   * snapshot completo podría, si esta escritura pierde una carrera contra un logout concurrente,
   * volver a poner `revokedAt` en `null` y resucitar una sesión que el cliente ya dio por cerrada.
   */
  recordActivity(session: Session): Promise<void>;
  /**
   * Actualización masiva de las sesiones no revocadas del usuario; devuelve cuántas cerró. La usa
   * la baja del acceso: la siguiente petición con cualquiera de sus tokens da 401.
   */
  revokeAllForUser(userId: UserId, now: Date): Promise<number>;
}
