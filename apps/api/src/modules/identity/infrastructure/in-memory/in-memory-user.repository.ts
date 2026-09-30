import { err, ok, type Email, type Result } from '@rrhh/domain';

import { EmployeeAlreadyLinkedError, UserAlreadyExistsError } from '../../domain/errors';
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

  findByEmployeeId(employeeId: string): Promise<User | null> {
    const found = [...this.users.values()].find((user) => user.snapshot.employeeId === employeeId);
    return Promise.resolve(found ?? null);
  }

  save(user: User): Promise<Result<void, UserAlreadyExistsError | EmployeeAlreadyLinkedError>> {
    const duplicate = [...this.users.values()].some(
      (other) => other.id !== user.id && other.snapshot.email.equals(user.snapshot.email),
    );
    if (duplicate) return Promise.resolve(err(new UserAlreadyExistsError()));
    const { employeeId } = user.snapshot;
    const linked =
      employeeId !== null &&
      [...this.users.values()].some(
        (other) => other.id !== user.id && other.snapshot.employeeId === employeeId,
      );
    if (linked) return Promise.resolve(err(new EmployeeAlreadyLinkedError()));
    this.users.set(user.id, user);
    return Promise.resolve(ok(undefined));
  }
}
