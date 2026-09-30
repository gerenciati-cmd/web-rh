import type { PasswordReset } from './password-reset';
import type { UserId } from './user';

export interface PasswordResetRepository {
  findByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  /** Solo restablecimientos pendientes (sin usar, sin reemplazar, sin expirar) en `now`. */
  findPendingForUser(userId: UserId, now: Date): Promise<PasswordReset[]>;
  /**
   * Persiste el restablecimiento. Uno ya usado o reemplazado en la base nunca se sobrescribe (la
   * decisión previa gana, ante escrituras concurrentes). Devuelve `false` si el cambio no se
   * aplicó por eso.
   */
  save(reset: PasswordReset): Promise<boolean>;
}
