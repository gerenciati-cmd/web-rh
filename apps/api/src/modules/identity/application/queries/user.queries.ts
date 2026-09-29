import type { SessionUser } from '@rrhh/contracts';

/** Puerto de lectura: la vista mínima de usuario que necesita `/auth/me`. */
export interface UserQueries {
  findSessionUser(userId: string): Promise<SessionUser | null>;
}
