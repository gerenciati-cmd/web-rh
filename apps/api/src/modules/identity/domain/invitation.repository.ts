import type { Email } from '@rrhh/domain';

import type { Invitation, InvitationId } from './invitation';

export interface InvitationRepository {
  findById(id: InvitationId): Promise<Invitation | null>;
  findByTokenHash(tokenHash: string): Promise<Invitation | null>;
  /** Solo invitaciones pendientes (sin aceptar, sin reemplazar, sin expirar) en `now`. */
  findPendingForEmployee(employeeId: string, now: Date): Promise<Invitation[]>;
  findPendingForEmail(email: Email, now: Date): Promise<Invitation[]>;
  save(invitation: Invitation): Promise<void>;
}
