/** Mismo esquema que las sesiones (ADR 0011): token opaco de 256 bits, solo se guarda el hash. */
export interface InvitationTokens {
  /** Genera el token en claro (viaja solo en el correo) y su hash (lo único que se persiste). */
  issue(): { token: string; tokenHash: string };
  hashOf(token: string): string;
}

/** Parámetros de las invitaciones, derivados de la configuración en el módulo. */
export interface InvitationPolicy {
  ttlMs: number;
  /** Base de los enlaces del correo, sin barra final. */
  appPublicUrl: string;
}
