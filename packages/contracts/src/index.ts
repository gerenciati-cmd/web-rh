export * from './common';
export * from './employees/employee.contract';
export * from './http';
export * from './identity/access.contract';
export * from './identity/auth.contract';
export * from './organization/company.contract';
export * from './openapi';

import { employeeRoutes } from './employees/employee.contract';
import { accessRoutes } from './identity/access.contract';
import { authRoutes } from './identity/auth.contract';
import { organizationRoutes } from './organization/company.contract';

/** Catálogo completo de la API. Agregar aquí las rutas de cada módulo nuevo. */
export const apiRoutes = {
  organization: organizationRoutes,
  employees: employeeRoutes,
  identity: authRoutes,
  access: accessRoutes,
} as const;
