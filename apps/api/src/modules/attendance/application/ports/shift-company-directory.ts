/** Lo que `attendance` necesita saber de las empresas (el adaptador es el único que conoce a organization). */
export interface ShiftCompanyDirectory {
  exists(companyId: string): Promise<boolean>;
}
