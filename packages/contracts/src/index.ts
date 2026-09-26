export * from './common';
export * from './employees/employee.contract';
export * from './http';
export * from './organization/company.contract';

import { employeeRoutes } from './employees/employee.contract';
import { organizationRoutes } from './organization/company.contract';

/** Catálogo completo de la API. Agregar aquí las rutas de cada módulo nuevo. */
export const apiRoutes = {
  organization: organizationRoutes,
  employees: employeeRoutes,
} as const;
