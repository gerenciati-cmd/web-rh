/**
 * Lo que `identity` necesita saber de un colaborador para invitarlo, en SUS propios términos.
 * Puerto de identity; el adaptador es el único que conoce la API pública de employees (ADR 0010).
 */
export interface InvitableEmployee {
  id: string;
  companyId: string;
  /** Correo de la ficha: valor por defecto de la invitación. */
  email: string;
  fullName: string;
  active: boolean;
}

export interface EmployeeDirectory {
  find(employeeId: string): Promise<InvitableEmployee | null>;
}
