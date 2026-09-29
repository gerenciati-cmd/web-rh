export interface SessionTokens {
  /** Genera el token en claro (se entrega al cliente) y su hash (lo único que se persiste). */
  issue(): { token: string; tokenHash: string };
  hashOf(token: string): string;
}
