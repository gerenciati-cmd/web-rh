/**
 * Lo que `attendance` necesita saber de un colaborador para calcular sus jornadas: el RFC es el
 * PIN de sus marcaciones, la sede da la zona horaria y las fechas acotan las jornadas (README de
 * attendance-asistencia-diaria, decisión 18).
 */
export interface WorkdayEmployee {
  id: string;
  companyId: string;
  active: boolean;
  rfc: string | null;
  siteId: string | null;
  /** Fecha de contratación `YYYY-MM-DD`. */
  hireDate: string;
  /** Fecha de baja `YYYY-MM-DD`; null si está activo o si la baja no guardó fecha. */
  terminationDate: string | null;
}

export interface WorkdayEmployeeDirectory {
  find(employeeId: string): Promise<WorkdayEmployee | null>;
}
