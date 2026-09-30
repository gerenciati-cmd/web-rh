import { authRoutes as routes } from '@rrhh/contracts';
import { Router } from 'express';

import { bindRoute, unwrap } from '@/http/bind-route';
import { AuthenticationRequiredError, SESSION_COOKIE, requireActor } from '@/http/request-context';

import type { LogIn } from '../application/commands/log-in.command';
import type { LogOut } from '../application/commands/log-out.command';
import type { GetCurrentUser } from '../application/queries/get-current-user.query';

export function createIdentityRouter(deps: {
  logIn: LogIn;
  logOut: LogOut;
  getCurrentUser: GetCurrentUser;
}): Router {
  const router = Router();

  bindRoute(router, routes.logIn, async ({ body }, ctx) => {
    const out = unwrap(
      await deps.logIn.execute({ ...body, ip: ctx.client.ip, userAgent: ctx.client.userAgent }),
    );

    if (body.client === 'web') {
      ctx.cookies.set(SESSION_COOKIE, out.token, out.expiresAt);
      return {
        user: out.user,
        expiresAt: out.expiresAt.toISOString(),
        token: null,
      };
    }

    return {
      user: out.user,
      expiresAt: out.expiresAt.toISOString(),
      token: out.token,
    };
  });

  bindRoute(router, routes.logOut, async (_request, ctx) => {
    const actor = requireActor(ctx);
    unwrap(await deps.logOut.execute({ sessionId: actor.sessionId }));
    ctx.cookies.clear(SESSION_COOKIE);
    return undefined;
  });

  bindRoute(router, routes.me, async (_request, ctx) => {
    const actor = requireActor(ctx);
    const user = await deps.getCurrentUser.execute({ userId: actor.userId });
    if (!user) throw new AuthenticationRequiredError();
    return user;
  });

  return router;
}
