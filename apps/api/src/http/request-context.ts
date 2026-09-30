import type { Actor } from '@/shared/application/actor';

/** Nombre de la cookie de sesión web. `__Host-` exige Secure, Path=/ y sin Domain (RFC 6265bis). */
export const SESSION_COOKIE = '__Host-rrhh_session';

/** Lo que cada handler recibe además del request ya parseado: quién llama y cómo responderle. */
export interface RequestContext {
  actor: Actor | null;
  client: { ip: string | null; userAgent: string | null };
  cookies: {
    set(name: string, value: string, expires: Date): void;
    clear(name: string): void;
  };
}

/** No hay actor autenticado. Es un error de ADAPTADOR, no de dominio (como RequestValidationError). */
export class AuthenticationRequiredError extends Error {
  readonly code = 'AUTHENTICATION_REQUIRED';

  constructor() {
    super('Debes iniciar sesión');
    this.name = 'AuthenticationRequiredError';
  }
}

/** Hay actor pero le falta el permiso (o el alcance) de la ruta. Error de ADAPTADOR → 403. */
export class PermissionDeniedError extends Error {
  readonly code = 'FORBIDDEN';

  constructor() {
    super('No tienes permiso para esta acción');
    this.name = 'PermissionDeniedError';
  }
}

export function requireActor(context: RequestContext): Actor {
  if (!context.actor) throw new AuthenticationRequiredError();
  return context.actor;
}
