import type { CountryCode } from '@rrhh/domain';

/**
 * Lo que `employees` necesita saber de una empresa, en SUS propios términos.
 *
 * Este puerto es del módulo employees (no de organization): así employees no depende
 * de cómo organization modela sus datos (anti-corruption layer). El adaptador que lo
 * implementa es el único que conoce la API pública de organization.
 */
export interface Employer {
  id: string;
  country: CountryCode;
  active: boolean;
}

export interface EmployerDirectory {
  find(companyId: string): Promise<Employer | null>;
}
