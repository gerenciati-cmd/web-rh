import type { Email, Result } from '@rrhh/domain';

import type { EmployeeAlreadyLinkedError, UserAlreadyExistsError } from './errors';
import type { User, UserId } from './user';

export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  findByEmployeeId(employeeId: string): Promise<User | null>;
  /**
   * Debe llamarse dentro de `transactionRunner.run`: bloquea la fila del usuario hasta el fin de
   * la transacción y serializa las operaciones concurrentes sobre ese usuario. `false` si no existe.
   */
  lock(id: UserId): Promise<boolean>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(user: User): Promise<Result<void, UserAlreadyExistsError | EmployeeAlreadyLinkedError>>;
}
