import { PERMISSIONS, type Grant, type Permission, type Role, type RoleScope } from '@rrhh/domain';

export interface RoleDefinition {
  scope: RoleScope;
  permissions: readonly Permission[];
  assignable: boolean;
}

/**
 * Catálogo fijo de roles (README decisiones 6 y 13). DIRECT_MANAGER y EMPLOYEE existen pero son
 * inertes: sus alcances (equipo, propio) aún no se aplican en ninguna consulta, así que no
 * conceden nada y no se pueden asignar hasta que existan `managerId` y `User.employeeId`.
 */
export const ROLE_DEFINITIONS: Readonly<Record<Role, RoleDefinition>> = {
  HOLDING_ADMIN: { scope: 'HOLDING', permissions: PERMISSIONS, assignable: true },
  HR: {
    scope: 'COMPANY',
    permissions: ['organization.companies:read', 'employees:read', 'employees:register'],
    assignable: true,
  },
  DIRECT_MANAGER: { scope: 'TEAM', permissions: [], assignable: false },
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
