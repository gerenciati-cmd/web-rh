/** Lo que `attendance` necesita saber de un colaborador para asignarle un turno. */
export interface ShiftEmployee {
  id: string;
  companyId: string;
  active: boolean;
}

export interface ShiftEmployeeDirectory {
  find(employeeId: string): Promise<ShiftEmployee | null>;
}
