import { accessRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { AssignRole } from '../application/commands/assign-role.command';
import type { RevokeRoleAssignment } from '../application/commands/revoke-role-assignment.command';
import type { ListRoleAssignments } from '../application/queries/list-role-assignments.query';
import type { ListUsers } from '../application/queries/list-users.query';

/** Usuarios y asignación de roles. El acceso lo hace cumplir `bindRoute` desde el contrato. */
export function createAccessRouter(deps: {
  listUsers: ListUsers;
  listRoleAssignments: ListRoleAssignments;
  assignRole: AssignRole;
  revokeRoleAssignment: RevokeRoleAssignment;
}): Router {
  const router = Router();

  bindRoute(router, routes.listUsers, ({ query }) => deps.listUsers.execute(query));

  bindRoute(router, routes.listRoleAssignments, async ({ params }) =>
    unwrap(await deps.listRoleAssignments.execute({ userId: params.userId })),
  );

  bindRoute(router, routes.assignRole, async ({ params, body }, ctx) =>
    unwrap(
      await deps.assignRole.execute({
        userId: params.userId,
        role: body.role,
        companyId: body.companyId ?? null,
        assignedBy: requireActor(ctx).userId,
      }),
    ),
  );

  bindRoute(router, routes.revokeRoleAssignment, async ({ params }, ctx) => {
    unwrap(
      await deps.revokeRoleAssignment.execute({
        userId: params.userId,
        assignmentId: params.assignmentId,
        revokedBy: requireActor(ctx).userId,
      }),
    );
    return undefined;
  });

  return router;
}
