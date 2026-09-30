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
    companyId: z.uuid().nullable(),
    assignedAt: z.iso.datetime(),
  })
  .meta({ id: 'RoleAssignment' });
export type RoleAssignmentDto = z.infer<typeof RoleAssignmentSchema>;

export const AssignRoleSchema = z
  .object({ role: RoleSchema, companyId: z.uuid().optional() })
  .meta({ id: 'AssignRoleInput' });
export type AssignRoleInput = z.input<typeof AssignRoleSchema>;

export const ListUsersQuerySchema = PageQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
});
export type ListUsersQuery = z.output<typeof ListUsersQuerySchema>;

const UserParams = z.object({ userId: z.uuid() });
const AssignmentParams = z.object({ userId: z.uuid(), assignmentId: z.uuid() });

export const accessRoutes = {
  listUsers: defineRoute({
    method: 'GET',
    path: '/users',
    summary: 'Lista paginada de usuarios',
    access: requires('identity.users:read'),
    query: ListUsersQuerySchema,
    response: pageOf(UserListItemSchema),
  }),
  listRoleAssignments: defineRoute({
    method: 'GET',
    path: '/users/:userId/role-assignments',
    summary: 'Roles activos de un usuario',
    access: requires('identity.roles:manage'),
    params: UserParams,
    response: z.array(RoleAssignmentSchema),
  }),
  assignRole: defineRoute({
    method: 'POST',
    path: '/users/:userId/role-assignments',
    summary: 'Asigna un rol a un usuario',
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
    access: requires('identity.roles:manage'),
    params: AssignmentParams,
    response: z.undefined(),
    successStatus: 204,
  }),
};
