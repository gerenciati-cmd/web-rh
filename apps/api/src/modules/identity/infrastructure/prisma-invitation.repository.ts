import type { Email } from '@rrhh/domain';

import type { PrismaDatabase } from '@/infrastructure/database/prisma-database';

import type { Invitation, InvitationId } from '../domain/invitation';
import type { InvitationRepository } from '../domain/invitation.repository';

import { InvitationMapper } from './invitation.mapper';

export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly deps: { database: PrismaDatabase }) {}

  async findById(id: InvitationId): Promise<Invitation | null> {
    const row = await this.deps.database.client.invitation.findUnique({ where: { id } });
    return row ? InvitationMapper.toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const row = await this.deps.database.client.invitation.findUnique({ where: { tokenHash } });
    return row ? InvitationMapper.toDomain(row) : null;
  }

  async findPendingForEmployee(employeeId: string, now: Date): Promise<Invitation[]> {
    const rows = await this.deps.database.client.invitation.findMany({
      where: { employeeId, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    });
    return rows.map((row) => InvitationMapper.toDomain(row));
  }

  async findPendingForEmail(email: Email, now: Date): Promise<Invitation[]> {
    const rows = await this.deps.database.client.invitation.findMany({
      where: { email: email.value, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
    });
    return rows.map((row) => InvitationMapper.toDomain(row));
  }

  async save(invitation: Invitation): Promise<boolean> {
    const data = InvitationMapper.toPersistence(invitation);
    const client = this.deps.database.client;
    // Condicional: solo una fila aún pendiente puede cambiar. Así un accept y un supersede
    // concurrentes no se pisan; el segundo ve la decisión del primero (el UPDATE espera el lock).
    const updated = await client.invitation.updateMany({
      where: { id: data.id, acceptedAt: null, revokedAt: null },
      data,
    });
    if (updated.count > 0) return true;
    if (await client.invitation.findUnique({ where: { id: data.id }, select: { id: true } })) {
      return false;
    }
    await client.invitation.create({ data });
    return true;
  }
}
