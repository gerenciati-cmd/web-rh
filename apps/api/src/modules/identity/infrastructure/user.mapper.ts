import { Email } from '@rrhh/domain';

import type { User as UserRow } from '@/infrastructure/database/generated/client';

import { User, type UserId } from '../domain/user';

export const UserMapper = {
  toDomain(row: UserRow): User {
    const email = Email.create(row.email);
    if (!email.ok) throw email.error;

    return User.restore(row.id as UserId, {
      email: email.value,
      passwordHash: row.passwordHash,
      status: row.status,
    });
  },

  toPersistence(user: User) {
    const s = user.snapshot;
    return {
      id: user.id,
      email: s.email.value,
      passwordHash: s.passwordHash,
      status: s.status,
    };
  },
};
