export * from './attendance/device.contract';
export * from './attendance/punch.contract';
export * from './common';
export * from './employees/employee.contract';
export * from './http';
export * from './identity/access.contract';
export * from './identity/auth.contract';
export * from './identity/invitation.contract';
export * from './identity/password-reset.contract';
export * from './organization/company.contract';
export * from './organization/site.contract';
export * from './openapi';

import { attendanceDeviceRoutes } from './attendance/device.contract';
import { attendancePunchRoutes } from './attendance/punch.contract';
import { employeeRoutes } from './employees/employee.contract';
import { accessRoutes } from './identity/access.contract';
import { authRoutes } from './identity/auth.contract';
import { invitationRoutes } from './identity/invitation.contract';
import { passwordResetRoutes } from './identity/password-reset.contract';
import { organizationRoutes } from './organization/company.contract';
import { siteRoutes } from './organization/site.contract';

/** Catálogo completo de la API. Agregar aquí las rutas de cada módulo nuevo. */
export const apiRoutes = {
  organization: organizationRoutes,
  sites: siteRoutes,
  employees: employeeRoutes,
  identity: authRoutes,
  access: accessRoutes,
  invitations: invitationRoutes,
  passwordResets: passwordResetRoutes,
  attendanceDevices: attendanceDeviceRoutes,
  attendancePunches: attendancePunchRoutes,
} as const;
