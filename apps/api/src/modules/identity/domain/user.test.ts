import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { USER_REGISTERED, User, type UserId } from './user';

const now = new Date('2026-01-15T12:00:00Z');

function email(raw: string): Email {
  const result = Email.create(raw);
  if (!result.ok) throw result.error;
  return result.value;
}

describe('User', () => {
  it('se registra en estado ACTIVE y registra USER_REGISTERED', () => {
    const user = User.register({
      id: 'user-1' as UserId,
      email: email('ana@aps.cl'),
      passwordHash: 'fake:contraseña-larga',
      now,
    });

    expect(user.snapshot.status).toBe('ACTIVE');
    expect(user.snapshot.email.value).toBe('ana@aps.cl');
    expect(user.snapshot.passwordHash).toBe('fake:contraseña-larga');
    expect(user.pullEvents().map((e) => e.name)).toEqual([USER_REGISTERED]);
  });

  it('canSignIn es true para un usuario ACTIVE', () => {
    const user = User.register({
      id: 'user-1' as UserId,
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      now,
    });

    expect(user.canSignIn).toBe(true);
  });

  it('canSignIn es false para un usuario DISABLED (restore)', () => {
    const user = User.restore('user-1' as UserId, {
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      status: 'DISABLED',
    });

    expect(user.canSignIn).toBe(false);
  });

  it('restore no registra eventos', () => {
    const user = User.restore('user-1' as UserId, {
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      status: 'ACTIVE',
    });

    expect(user.pullEvents()).toEqual([]);
  });
});
