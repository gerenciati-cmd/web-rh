/** Vocabulario puro de employees, compartido con el contrato; persistencia mantiene su enum. */
export const EMPLOYEE_STATUSES = ['ACTIVE', 'TERMINATED'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];
