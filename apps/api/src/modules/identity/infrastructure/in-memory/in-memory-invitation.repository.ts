import type { Email } from '@rrhh/domain';

import { Invitation, type InvitationId } from '../../domain/invitation';
import type { InvitationRepository } from '../../domain/invitation.repository';

// Guarda y entrega copias: si el agregado del llamador fuera el mismo objeto que el guardado, el
// guardado condicional de `save` nunca podría ver que otra operación cerró la invitación antes.
const copy = (invitation: Invitation) =>
  Invitation.restore(invitation.id, { ...invitation.snapshot });

export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations = new Map<string, Invitation>();

  findById(id: InvitationId): Promise<Invitation | null> {
    const found = this.invitations.get(id);
    return Promise.resolve(found ? copy(found) : null);
  }

  findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const found = [...this.invitations.values()].find(
      (invitation) => invitation.snapshot.tokenHash === tokenHash,
    );
    return Promise.resolve(found ? copy(found) : null);
  }

  findPendingForEmployee(employeeId: string, now: Date): Promise<Invitation[]> {
    return Promise.resolve(
      [...this.invitations.values()]
        .filter(
          (invitation) =>
            invitation.snapshot.employeeId === employeeId && invitation.isPendingAt(now),
        )
        .map(copy),
    );
  }

  findPendingForEmail(email: Email, now: Date): Promise<Invitation[]> {
    return Promise.resolve(
      [...this.invitations.values()]
        .filter(
          (invitation) => invitation.snapshot.email.equals(email) && invitation.isPendingAt(now),
        )
        .map(copy),
    );
  }

  /** Igual que el adaptador Prisma: una invitación ya aceptada o anulada no se sobrescribe. */
  save(invitation: Invitation): Promise<boolean> {
    const stored = this.invitations.get(invitation.id);
    if (stored && (stored.snapshot.acceptedAt || stored.snapshot.revokedAt)) {
      return Promise.resolve(false);
    }
    this.invitations.set(invitation.id, copy(invitation));
    return Promise.resolve(true);
  }
}
