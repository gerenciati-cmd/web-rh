import { Email } from '@rrhh/domain';

import type { Invitation as InvitationRow } from '@/infrastructure/database/generated/client';

import { Invitation, type InvitationId } from '../domain/invitation';
import type { UserId } from '../domain/user';

export const InvitationMapper = {
  toDomain(row: InvitationRow): Invitation {
    const email = Email.create(row.email);
    if (!email.ok) throw email.error;

    return Invitation.restore(row.id as InvitationId, {
      email: email.value,
      employeeId: row.employeeId,
      companyId: row.companyId,
      tokenHash: row.tokenHash,
      invitedBy: row.invitedBy as UserId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      acceptedAt: row.acceptedAt,
      revokedAt: row.revokedAt,
    });
  },

  toPersistence(invitation: Invitation) {
    const s = invitation.snapshot;
    return {
      id: invitation.id,
      email: s.email.value,
      employeeId: s.employeeId,
      companyId: s.companyId,
      tokenHash: s.tokenHash,
      invitedBy: s.invitedBy,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
      acceptedAt: s.acceptedAt,
      revokedAt: s.revokedAt,
    };
  },
};
