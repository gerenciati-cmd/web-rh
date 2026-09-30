import type { Email } from '@rrhh/domain';

import type { Invitation, InvitationId } from '../../domain/invitation';
import type { InvitationRepository } from '../../domain/invitation.repository';

export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations = new Map<string, Invitation>();

  findById(id: InvitationId): Promise<Invitation | null> {
    return Promise.resolve(this.invitations.get(id) ?? null);
  }

  findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const found = [...this.invitations.values()].find(
      (invitation) => invitation.snapshot.tokenHash === tokenHash,
    );
    return Promise.resolve(found ?? null);
  }

  findPendingForEmployee(employeeId: string, now: Date): Promise<Invitation[]> {
    return Promise.resolve(
      [...this.invitations.values()].filter(
        (invitation) =>
          invitation.snapshot.employeeId === employeeId && invitation.isPendingAt(now),
      ),
    );
  }

  findPendingForEmail(email: Email, now: Date): Promise<Invitation[]> {
    return Promise.resolve(
      [...this.invitations.values()].filter(
        (invitation) => invitation.snapshot.email.equals(email) && invitation.isPendingAt(now),
      ),
    );
  }

  save(invitation: Invitation): Promise<boolean> {
    this.invitations.set(invitation.id, invitation);
    return Promise.resolve(true);
  }
}
