import type { CountryCode } from '@rrhh/domain';

/**
 * Lo que `employees` necesita saber de una sede, en SUS propios términos
 * (misma idea que `EmployerDirectory`: el adaptador es el único que conoce a organization).
 */
export interface WorkSite {
  id: string;
  country: CountryCode;
  active: boolean;
}

export interface SiteDirectory {
  find(siteId: string): Promise<WorkSite | null>;
}
