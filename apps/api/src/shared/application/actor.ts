/** Quién hace la petición actual, resuelto por la autenticación antes de llegar al caso de uso. */
export interface Actor {
  userId: string;
  sessionId: string;
}

/**
 * Puerto compartido: `src/http/` lo consume para poblar el `RequestContext` de cada petición,
 * y el módulo `identity` lo implementa. Nunca lanza para token desconocido, expirado, revocado
 * o de un usuario deshabilitado: en esos casos resuelve `null` y quien llama decide (401).
 */
export interface RequestAuthenticator {
  authenticate(token: string): Promise<Actor | null>;
}
