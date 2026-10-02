/**
 * Dueño de una marcación, en términos de attendance. El PIN del checador es el RFC del
 * colaborador (README de attendance-marcaciones, decisión 7); el adaptador es el único que
 * conoce la API pública de employees (ADR 0010).
 */
export interface PunchOwner {
  employeeId: string;
  companyId: string;
  fullName: string;
}

export interface PunchOwnerDirectory {
  /** Dueños de esos PIN, indexados por PIN; los PIN sin colaborador no aparecen. */
  ownersOf(pins: readonly string[]): Promise<ReadonlyMap<string, PunchOwner>>;
  /** PIN (RFC) de los colaboradores de esas empresas. */
  pinsOfCompanies(companyIds: readonly string[]): Promise<string[]>;
}
