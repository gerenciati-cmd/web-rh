import { ROLES } from '@rrhh/domain';
import { z } from 'zod';

import { CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

export const RoleSchema = z.enum(ROLES);

export const UserListItemSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    status: z.enum(['ACTIVE', 'DISABLED']),
  })
  .meta({ id: 'UserListItem' });
export type UserListItem = z.infer<typeof UserListItemSchema>;

export const RoleAssignmentSchema = z
  .object({
    id: z.uuid(),
    role: RoleSchema,
    companyId: z
      .uuid()
      .nullable()
      .describe('Empresa del alcance; null si el rol es de todo el holding'),
    assignedAt: z.iso.datetime(),
  })
  .meta({ id: 'RoleAssignment' });
export type RoleAssignmentDto = z.infer<typeof RoleAssignmentSchema>;

export const AssignRoleSchema = z
  .object({
    role: RoleSchema.describe(
      'Rol a asignar; solo HOLDING_ADMIN y HR se pueden asignar por la API',
    ),
    companyId: z
      .uuid()
      .optional()
      .describe(
        'Opcional. Empresa del alcance: obligatoria para HR y prohibida para HOLDING_ADMIN',
      ),
  })
  .meta({ id: 'AssignRoleInput' });
export type AssignRoleInput = z.input<typeof AssignRoleSchema>;

export const ListUsersQuerySchema = PageQuerySchema.extend({
  search: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Opcional. Texto a buscar en el correo; si se omite no filtra'),
});
export type ListUsersQuery = z.output<typeof ListUsersQuerySchema>;

const UserParams = z.object({ userId: z.uuid().describe('Id del usuario') });
const AssignmentParams = z.object({
  userId: z.uuid().describe('Id del usuario'),
  assignmentId: z.uuid().describe('Id de la asignación de rol'),
});

export const accessRoutes = {
  listUsers: defineRoute({
    method: 'GET',
    path: '/users',
    summary: 'Lista paginada de usuarios',
    description: [
      'Devuelve los usuarios con cuenta, paginados, con búsqueda opcional por correo.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** opcionalmente `page`, `pageSize` y `search`. No modifica datos.',
    ].join('\n'),
    access: requires('identity.users:read'),
    query: ListUsersQuerySchema,
    response: pageOf(UserListItemSchema),
  }),
  listRoleAssignments: defineRoute({
    method: 'GET',
    path: '/users/:userId/role-assignments',
    summary: 'Roles activos de un usuario',
    description: [
      'Devuelve las asignaciones de rol activas de un usuario.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el `userId` en la ruta. No modifica datos.',
    ].join('\n'),
    errors: ['USER_NOT_FOUND'],
    access: requires('identity.roles:manage'),
    params: UserParams,
    response: z.array(RoleAssignmentSchema),
  }),
  assignRole: defineRoute({
    method: 'POST',
    path: '/users/:userId/role-assignments',
    summary: 'Asigna un rol a un usuario',
    description: [
      'Concede un rol a un usuario. Los permisos del usuario cambian de inmediato.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el rol y, para HR, la empresa de su alcance (HOLDING_ADMIN no lleva empresa). Responde con el `id` de la asignación.',
    ].join('\n'),
    errors: [
      'USER_NOT_FOUND',
      'COMPANY_NOT_FOUND',
      'ROLE_ALREADY_ASSIGNED',
      { code: 'COMPANY_INACTIVE', variant: 'role_assignment' },
      'ROLE_NOT_ASSIGNABLE',
      'INVALID_ROLE_SCOPE',
    ],
    access: requires('identity.roles:manage'),
    params: UserParams,
    body: AssignRoleSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
  revokeRoleAssignment: defineRoute({
    method: 'DELETE',
    path: '/users/:userId/role-assignments/:assignmentId',
    summary: 'Revoca una asignación de rol',
    description: [
      'Quita una asignación de rol a un usuario. El usuario pierde esos permisos de inmediato.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** el `userId` y el `assignmentId` en la ruta. No se puede revocar al último administrador del holding.',
    ].join('\n'),
    errors: ['ROLE_ASSIGNMENT_NOT_FOUND', 'LAST_HOLDING_ADMIN'],
    access: requires('identity.roles:manage'),
    params: AssignmentParams,
    response: z.undefined(),
    successStatus: 204,
  }),
};
