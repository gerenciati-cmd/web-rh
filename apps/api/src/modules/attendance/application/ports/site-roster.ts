/** Colaborador de una sede, en términos de attendance. El PIN en el checador es su RFC. */
export interface RosterMember {
  employeeId: string;
  fullName: string;
  rfc: string | null;
}

/**
 * Quién pertenece a una sede; el adaptador es el único que conoce la API pública de employees
 * (ADR 0010).
 */
export interface SiteRoster {
  /** Colaboradores activos de la sede. */
  activeMembers(siteId: string): Promise<RosterMember[]>;
  /** Dónde está hoy un colaborador; null si no existe. */
  findPlacement(
    employeeId: string,
  ): Promise<{ member: RosterMember; siteId: string | null; active: boolean } | null>;
}
