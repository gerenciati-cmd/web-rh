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
      'employees:read',
      'employees:register',
      'employees:update',
      // Solo el estado de los checadores: las marcaciones crudas no tienen empresa hasta el plan 002
      // (README de attendance-marcaciones, decisión 5), así que RRHH no recibe `attendance.punches:read`.
      'attendance.devices:read',
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
