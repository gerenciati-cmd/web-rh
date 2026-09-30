import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { PasswordReset } from '../domain/password-reset';
import type { PasswordResetRepository } from '../domain/password-reset.repository';
import type { UserId } from '../domain/user';

import { PasswordResetMapper } from './password-reset.mapper';

export class PrismaPasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const row = await this.deps.database.client.passwordReset.findUnique({ where: { tokenHash } });
    return row ? PasswordResetMapper.toDomain(row) : null;
  }

  async findPendingForUser(userId: UserId, now: Date): Promise<PasswordReset[]> {
    const rows = await this.deps.database.client.passwordReset.findMany({
      where: { userId, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
    });
    return rows.map((row) => PasswordResetMapper.toDomain(row));
  }

  async save(reset: PasswordReset): Promise<boolean> {
    const data = PasswordResetMapper.toPersistence(reset);
    const client = this.deps.database.client;
    // Condicional: solo una fila aún pendiente puede cambiar. Así un use y un supersede
    // concurrentes no se pisan; el segundo ve la decisión del primero (el UPDATE espera el lock).
    const updated = await client.passwordReset.updateMany({
      where: { id: data.id, usedAt: null, revokedAt: null },
      data,
    });
    if (updated.count > 0) return true;
    if (await client.passwordReset.findUnique({ where: { id: data.id }, select: { id: true } })) {
      return false;
    }
    await client.passwordReset.create({ data });
    return true;
  }
}
