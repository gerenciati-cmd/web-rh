import { PERMISSIONS, type Grant, type Permission, type Role, type RoleScope } from '@rrhh/domain';

export interface RoleDefinition {
  scope: RoleScope;
  permissions: readonly Permission[];
  assignable: boolean;
}

/**
 * Catálogo fijo de roles (README decisiones 6 y 13). DIRECT_MANAGER y EMPLOYEE existen pero son
 * inertes: sus alcances (equipo, propio) aún no se aplican en ninguna consulta, así que no
 * conceden nada y no se pueden asignar por HTTP (EMPLOYEE se concede solo al activar una invitación).
 */
export const ROLE_DEFINITIONS: Readonly<Record<Role, RoleDefinition>> = {
  HOLDING_ADMIN: { scope: 'HOLDING', permissions: PERMISSIONS, assignable: true },
  HR: {
    scope: 'COMPANY',
    permissions: [
      'organization.companies:read',
      'organization.sites:read',
      'employees:read',
      'employees:register',
      'employees:update',
      'employees:terminate',
      'attendance.devices:read',
      // Ve las marcaciones de los colaboradores de sus empresas, atribuidas por RFC
      // (README de attendance-marcaciones, decisión 8).
      'attendance.punches:read',
      // Define los turnos de sus empresas y los asigna a sus colaboradores (README de
      // attendance-asistencia-diaria, decisión 11).
      'attendance.shifts:read',
      'attendance.shifts:manage',
      // Consulta y recalcula las jornadas de los colaboradores de sus empresas (README de
      // attendance-asistencia-diaria, decisión 11).
      'attendance.workdays:read',
      'attendance.workdays:recalculate',
      'identity.users:invite',
      'identity.users:reset-password',
    ],
    assignable: true,
  },
  DIRECT_MANAGER: { scope: 'TEAM', permissions: [], assignable: false },
  // No asignable por HTTP: solo se concede al activar una invitación (`RoleAssignment.grantSelf`).
  EMPLOYEE: { scope: 'SELF', permissions: [], assignable: false },
};

/** Expande asignaciones activas a concesiones; `companyId: null` = todo el holding. */
export function grantsFor(
  assignments: readonly { role: Role; companyId: string | null }[],
): Grant[] {
  return assignments.flatMap(({ role, companyId }) =>
    ROLE_DEFINITIONS[role].permissions.map((permission) => ({ permission, companyId })),
  );
}
