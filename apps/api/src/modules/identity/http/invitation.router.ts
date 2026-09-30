import { invitationRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { ActivateAccount } from '../application/commands/activate-account.command';
import type { InviteEmployee } from '../application/commands/invite-employee.command';
import type { InviteExternal } from '../application/commands/invite-external.command';

/** Invitaciones y activación. El acceso lo hace cumplir `bindRoute` desde el contrato. */
export function createInvitationRouter(deps: {
  inviteEmployee: InviteEmployee;
  inviteExternal: InviteExternal;
  activateAccount: ActivateAccount;
}): Router {
  const router = Router();

  bindRoute(router, routes.inviteEmployee, async ({ params, body }, ctx) =>
    unwrap(
      await deps.inviteEmployee.execute({
        companyId: params.companyId,
        employeeId: params.employeeId,
        email: body.email,
        invitedBy: requireActor(ctx).userId,
      }),
    ),
  );

  bindRoute(router, routes.inviteExternal, async ({ body }, ctx) =>
    unwrap(
      await deps.inviteExternal.execute({
        email: body.email,
        invitedBy: requireActor(ctx).userId,
      }),
    ),
  );

  bindRoute(router, routes.activateAccount, async ({ body }) => {
    unwrap(await deps.activateAccount.execute(body));
    return undefined;
  });

  return router;
}
