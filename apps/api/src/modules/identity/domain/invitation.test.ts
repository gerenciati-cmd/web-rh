import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import {
  INVITATION_ACCEPTED,
  INVITATION_ISSUED,
  Invitation,
  type InvitationId,
} from './invitation';
import type { UserId } from './user';

const NOW = new Date('2026-01-15T12:00:00Z');
const TTL_MS = 3_600_000;
const INVITER = 'user-admin' as UserId;

function email(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

function issue(employeeId: string | null = 'employee-1'): Invitation {
  return Invitation.issue({
    id: 'inv-1' as InvitationId,
    email: email('ana@aps.cl'),
    employeeId,
    companyId: employeeId === null ? null : 'company-a',
    tokenHash: 'a'.repeat(64),
    invitedBy: INVITER,
    ttlMs: TTL_MS,
    now: NOW,
  });
}

describe('Invitation.issue', () => {
  it('nace pendiente, vence a now + ttl y registra INVITATION_ISSUED sin el hash del token', () => {
    const invitation = issue();

    expect(invitation.snapshot).toMatchObject({
      employeeId: 'employee-1',
      companyId: 'company-a',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + TTL_MS),
      acceptedAt: null,
      revokedAt: null,
    });
    expect(invitation.isPendingAt(NOW)).toBe(true);
    const events = invitation.pullEvents();
    expect(events.map((event) => event.name)).toEqual([INVITATION_ISSUED]);
    expect(JSON.stringify(events[0]?.payload)).not.toContain('a'.repeat(64));
  });

  it('una invitación externa no lleva colaborador ni empresa', () => {
    expect(issue(null).snapshot).toMatchObject({ employeeId: null, companyId: null });
  });
});

describe('Invitation.isPendingAt', () => {
  it('deja de estar pendiente exactamente al llegar a expiresAt', () => {
    const invitation = issue();
    const justBefore = new Date(NOW.getTime() + TTL_MS - 1);
    const atExpiry = new Date(NOW.getTime() + TTL_MS);

    expect(invitation.isPendingAt(justBefore)).toBe(true);
    expect(invitation.isPendingAt(atExpiry)).toBe(false);
  });
});

describe('Invitation.accept', () => {
  it('pendiente: queda aceptada y registra INVITATION_ACCEPTED', () => {
    const invitation = issue();
    invitation.pullEvents();

    const result = invitation.accept(NOW);

    expect(result.ok).toBe(true);
    expect(invitation.snapshot.acceptedAt).toEqual(NOW);
    expect(invitation.isPendingAt(NOW)).toBe(false);
    expect(invitation.pullEvents().map((event) => event.name)).toEqual([INVITATION_ACCEPTED]);
  });

  it('una segunda aceptación: INVITATION_NOT_VALID y sin evento', () => {
    const invitation = issue();
    invitation.accept(NOW);
    invitation.pullEvents();

    const result = invitation.accept(NOW);

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(invitation.pullEvents()).toEqual([]);
  });

  it('expirada: INVITATION_NOT_VALID', () => {
    const invitation = issue();

    const result = invitation.accept(new Date(NOW.getTime() + TTL_MS));

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
    expect(invitation.snapshot.acceptedAt).toBeNull();
  });

  it('reemplazada: INVITATION_NOT_VALID', () => {
    const invitation = issue();
    invitation.supersede(NOW);

    const result = invitation.accept(NOW);

    expect(!result.ok && result.error.code).toBe('INVITATION_NOT_VALID');
  });
});

describe('Invitation.supersede', () => {
  it('pendiente: marca revokedAt y deja de estar pendiente', () => {
    const invitation = issue();

    invitation.supersede(NOW);

    expect(invitation.snapshot.revokedAt).toEqual(NOW);
    expect(invitation.isPendingAt(NOW)).toBe(false);
  });

  it('es no-op si ya no está pendiente: conserva la marca original', () => {
    const invitation = issue();
    const later = new Date(NOW.getTime() + 1000);
    invitation.supersede(NOW);

    invitation.supersede(later);

    expect(invitation.snapshot.revokedAt).toEqual(NOW);
  });

  it('es no-op sobre una invitación ya aceptada', () => {
    const invitation = issue();
    invitation.accept(NOW);

    invitation.supersede(NOW);

    expect(invitation.snapshot.revokedAt).toBeNull();
  });

  it('es no-op sobre una invitación expirada', () => {
    const invitation = issue();

    invitation.supersede(new Date(NOW.getTime() + TTL_MS));

    expect(invitation.snapshot.revokedAt).toBeNull();
  });
});

describe('Invitation.restore', () => {
  it('rehidrata sin emitir eventos', () => {
    const original = issue();
    const restored = Invitation.restore('inv-1' as InvitationId, original.snapshot);

    expect(restored.pullEvents()).toEqual([]);
    expect(restored.isPendingAt(NOW)).toBe(true);
  });
});
