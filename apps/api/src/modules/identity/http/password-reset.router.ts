import { passwordResetRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { requireActor } from '@/http/request-context';

import type { ForceEmployeePasswordReset } from '../application/commands/force-employee-password-reset.command';
import type { ForceUserPasswordReset } from '../application/commands/force-user-password-reset.command';
import type { RequestPasswordReset } from '../application/commands/request-password-reset.command';
import type { ResetPassword } from '../application/commands/reset-password.command';

/** Restablecimiento de contraseña. El acceso lo hace cumplir `bindRoute` desde el contrato. */
export function createPasswordResetRouter(deps: {
  requestPasswordReset: RequestPasswordReset;
  resetPassword: ResetPassword;
  forceEmployeePasswordReset: ForceEmployeePasswordReset;
  forceUserPasswordReset: ForceUserPasswordReset;
}): Router {
  const router = Router();

  bindRoute(router, routes.requestPasswordReset, async ({ body }) => {
    unwrap(await deps.requestPasswordReset.execute(body));
    return undefined;
  });

  bindRoute(router, routes.resetPassword, async ({ body }) => {
    unwrap(await deps.resetPassword.execute(body));
    return undefined;
  });

  bindRoute(router, routes.forceEmployeePasswordReset, async ({ params }, ctx) =>
    unwrap(
      await deps.forceEmployeePasswordReset.execute({
        companyId: params.companyId,
        employeeId: params.employeeId,
        requestedBy: requireActor(ctx).userId,
      }),
    ),
  );

  bindRoute(router, routes.forceUserPasswordReset, async ({ params }, ctx) =>
    unwrap(
      await deps.forceUserPasswordReset.execute({
        userId: params.userId,
        requestedBy: requireActor(ctx).userId,
      }),
    ),
  );

  return router;
}
