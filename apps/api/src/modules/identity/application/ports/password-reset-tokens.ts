/** Mismo esquema que las invitaciones y sesiones (ADR 0011): token opaco de 256 bits, solo se guarda el hash. */
export interface PasswordResetTokens {
  /** Genera el token en claro (viaja solo en el correo) y su hash (lo único que se persiste). */
  issue(): { token: string; tokenHash: string };
  hashOf(token: string): string;
}

/** Parámetros del restablecimiento de contraseña, derivados de la configuración en el módulo. */
export interface PasswordResetPolicy {
  ttlMs: number;
  /** Espera mínima entre dos solicitudes públicas del mismo usuario (anti-inundación de correo). */
  cooldownMs: number;
  /** Base de los enlaces del correo, sin barra final. */
  appPublicUrl: string;
}
