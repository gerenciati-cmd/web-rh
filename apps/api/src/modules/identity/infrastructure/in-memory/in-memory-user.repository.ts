import { err, ok, type Email, type Result } from '@rrhh/domain';

import { UserAlreadyExistsError } from '../../domain/errors';
import type { User, UserId } from '../../domain/user';
import type { UserRepository } from '../../domain/user.repository';

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();

  findById(id: UserId): Promise<User | null> {
    return Promise.resolve(this.users.get(id) ?? null);
  }

  findByEmail(email: Email): Promise<User | null> {
    const found = [...this.users.values()].find((user) => user.snapshot.email.equals(email));
    return Promise.resolve(found ?? null);
  }

  save(user: User): Promise<Result<void, UserAlreadyExistsError>> {
    const duplicate = [...this.users.values()].some(
      (other) => other.id !== user.id && other.snapshot.email.equals(user.snapshot.email),
    );
    if (duplicate) return Promise.resolve(err(new UserAlreadyExistsError()));
    this.users.set(user.id, user);
    return Promise.resolve(ok(undefined));
  }
}
