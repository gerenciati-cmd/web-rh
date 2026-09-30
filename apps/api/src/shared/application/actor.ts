import type { Grant, Permission } from '@rrhh/domain';

export type { Grant };

/**
 * Quién hace la petición actual, resuelto por la autenticación antes de llegar al caso de uso.
 * Los `grants` se expanden una vez por petición desde sus asignaciones de rol activas (ADR 0012).
 */
export interface Actor {
  userId: string;
  sessionId: string;
  grants: readonly Grant[];
}

/**
 * ¿Puede el actor ejercer `permission`? Sin `companyId`: basta cualquier concesión de ese permiso
 * (ruta sin empresa; el filtrado de filas lo hace el caso de uso). Con `companyId`: la concesión
 * debe ser de todo el holding o de esa empresa.
 */
export function hasPermission(actor: Actor, permission: Permission, companyId?: string): boolean {
  return actor.grants.some(
    (grant) =>
      grant.permission === permission &&
      (companyId === undefined || grant.companyId === null || grant.companyId === companyId),
  );
}

/**
 * Empresas sobre las que el actor tiene `permission`: `'ALL'` si alguna concesión abarca el
 * holding completo, si no los ids distintos de sus empresas (vacío = ninguna).
 */
export function companiesWith(actor: Actor, permission: Permission): 'ALL' | readonly string[] {
  const companyIds = new Set<string>();
  for (const grant of actor.grants) {
    if (grant.permission !== permission) continue;
    if (grant.companyId === null) return 'ALL';
    companyIds.add(grant.companyId);
  }
  return [...companyIds];
}

/**
 * Puerto compartido: `src/http/` lo consume para poblar el `RequestContext` de cada petición,
 * y el módulo `identity` lo implementa. Nunca lanza para token desconocido, expirado, revocado
 * o de un usuario deshabilitado: en esos casos resuelve `null` y quien llama decide (401).
 */
export interface RequestAuthenticator {
  authenticate(token: string): Promise<Actor | null>;
}
