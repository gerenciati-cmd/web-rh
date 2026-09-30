/**
 * Lo que `identity` necesita saber de una empresa para asignar un rol con alcance de empresa,
 * en SUS propios términos. Puerto de identity; el adaptador es el único que conoce la API
 * pública de organization (ADR 0010).
 */
export interface AssignableCompany {
  id: string;
  active: boolean;
}

export interface CompanyDirectory {
  find(companyId: string): Promise<AssignableCompany | null>;
}
