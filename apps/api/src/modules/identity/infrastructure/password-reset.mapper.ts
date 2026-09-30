import type { PasswordReset as PasswordResetRow } from '@/infrastructure/database/generated/client';

import { PasswordReset, type PasswordResetId } from '../domain/password-reset';
import type { UserId } from '../domain/user';

export const PasswordResetMapper = {
  toDomain(row: PasswordResetRow): PasswordReset {
    return PasswordReset.restore(row.id as PasswordResetId, {
      userId: row.userId as UserId,
      tokenHash: row.tokenHash,
      requestedBy: row.requestedBy as UserId | null,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      usedAt: row.usedAt,
      revokedAt: row.revokedAt,
    });
  },

  toPersistence(reset: PasswordReset) {
    const s = reset.snapshot;
    return {
      id: reset.id,
      userId: s.userId,
      tokenHash: s.tokenHash,
      requestedBy: s.requestedBy,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      usedAt: s.usedAt,
      revokedAt: s.revokedAt,
    };
  },
};
