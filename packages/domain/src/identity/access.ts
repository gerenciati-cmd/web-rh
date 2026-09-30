/**
 * Vocabulario puro de autorización, compartido entre contratos y API (ADR 0007). El dueño es el
 * módulo identity: el mapeo rol → permisos vive en `identity/domain/role-catalog.ts`; aquí solo
 * están los nombres estables.
 */
export const PERMISSIONS = [
  'organization.companies:read',
  'organization.companies:create',
  'employees:read',
  'employees:register',
  'identity.users:read',
  'identity.roles:manage',
  'identity.users:invite',
  'identity.users:invite-external',
  'identity.users:reset-password',
  'identity.users:reset-password-any',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLES = ['HOLDING_ADMIN', 'HR', 'DIRECT_MANAGER', 'EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

/**
 * Un permiso concedido a un actor. `companyId: null` = todo el holding; con id = solo esa empresa.
 * Vive aquí (no en `shared/application`) porque el dominio de identity lo produce y `arch:check`
 * le prohíbe importar de la capa de aplicación.
 */
export interface Grant {
  permission: Permission;
  companyId: string | null;
}

export const ROLE_SCOPES = ['HOLDING', 'COMPANY', 'TEAM', 'SELF'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];
