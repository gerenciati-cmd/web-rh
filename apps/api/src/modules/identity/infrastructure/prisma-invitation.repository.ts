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

  async save(invitation: Invitation): Promise<void> {
    const data = InvitationMapper.toPersistence(invitation);
    await this.deps.database.client.invitation.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }
}
