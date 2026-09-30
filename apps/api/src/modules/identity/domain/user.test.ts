import { Email } from '@rrhh/domain';
import { describe, expect, it } from 'vitest';

import { USER_DISABLED, USER_REGISTERED, User, type UserId } from './user';

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
      employeeId: null,
      now,
    });

    expect(user.canSignIn).toBe(true);
  });

  it('canSignIn es false para un usuario DISABLED (restore)', () => {
    const user = User.restore('user-1' as UserId, {
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      employeeId: null,
      status: 'DISABLED',
    });

    expect(user.canSignIn).toBe(false);
  });

  it('restore no registra eventos', () => {
    const user = User.restore('user-1' as UserId, {
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      employeeId: null,
      status: 'ACTIVE',
    });

    expect(user.pullEvents()).toEqual([]);
  });

  it('register sin employeeId lo deja en null; con employeeId lo vincula', () => {
    const base = {
      id: 'user-1' as UserId,
      email: email('ana@aps.cl'),
      passwordHash: 'hash',
      now,
    };

    expect(User.register(base).snapshot.employeeId).toBeNull();
    expect(User.register({ ...base, employeeId: 'employee-1' }).snapshot.employeeId).toBe(
      'employee-1',
    );
  });

  describe('disable', () => {
    function active(): User {
      const user = User.register({
        id: 'user-1' as UserId,
        email: email('ana@aps.cl'),
        passwordHash: 'hash',
        now,
      });
      user.pullEvents();
      return user;
    }

    it('pasa a DISABLED, ya no puede iniciar sesión y registra USER_DISABLED', () => {
      const user = active();

      user.disable(now);

      expect(user.snapshot.status).toBe('DISABLED');
      expect(user.canSignIn).toBe(false);
      expect(user.pullEvents().map((e) => e.name)).toEqual([USER_DISABLED]);
    });

    it('es idempotente: la segunda vez no emite otro evento', () => {
      const user = active();
      user.disable(now);
      user.pullEvents();

      user.disable(new Date('2026-02-01T00:00:00Z'));

      expect(user.snapshot.status).toBe('DISABLED');
      expect(user.pullEvents()).toEqual([]);
    });

    it('conserva email, hash y vínculo con el colaborador (nunca se borra)', () => {
      const user = User.register({
        id: 'user-1' as UserId,
        email: email('ana@aps.cl'),
        passwordHash: 'hash',
        employeeId: 'employee-1',
        now,
      });

      user.disable(now);

      expect(user.snapshot).toMatchObject({ passwordHash: 'hash', employeeId: 'employee-1' });
      expect(user.snapshot.email.value).toBe('ana@aps.cl');
    });
  });
});
