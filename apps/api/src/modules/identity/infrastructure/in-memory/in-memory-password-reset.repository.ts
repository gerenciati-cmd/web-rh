import { PasswordReset } from '../../domain/password-reset';
import type { PasswordResetRepository } from '../../domain/password-reset.repository';
import type { UserId } from '../../domain/user';

// Guarda y entrega copias: si el agregado del llamador fuera el mismo objeto que el guardado, el
// guardado condicional de `save` nunca podría ver que otra operación cerró el restablecimiento antes.
const copy = (reset: PasswordReset) => PasswordReset.restore(reset.id, { ...reset.snapshot });

export class InMemoryPasswordResetRepository implements PasswordResetRepository {
  readonly resets = new Map<string, PasswordReset>();

  findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const found = [...this.resets.values()].find((reset) => reset.snapshot.tokenHash === tokenHash);
    return Promise.resolve(found ? copy(found) : null);
  }

  findPendingForUser(userId: UserId, now: Date): Promise<PasswordReset[]> {
    return Promise.resolve(
      [...this.resets.values()]
        .filter((reset) => reset.snapshot.userId === userId && reset.isPendingAt(now))
        .map(copy),
    );
  }

  /** Igual que el adaptador Prisma: uno ya usado o reemplazado no se sobrescribe. */
  save(reset: PasswordReset): Promise<boolean> {
    const stored = this.resets.get(reset.id);
    if (stored && (stored.snapshot.usedAt || stored.snapshot.revokedAt)) {
      return Promise.resolve(false);
    }
    this.resets.set(reset.id, copy(reset));
    return Promise.resolve(true);
  }
}
