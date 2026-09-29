import type { Email, Result } from '@rrhh/domain';

import type { UserAlreadyExistsError } from './errors';
import type { User, UserId } from './user';

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(user: User): Promise<Result<void, UserAlreadyExistsError>>;
}
