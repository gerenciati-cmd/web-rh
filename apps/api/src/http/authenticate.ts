import type { Request, RequestHandler } from 'express';

import type { RequestAuthenticator } from '@/shared/application/actor';

import { SESSION_COOKIE } from './request-context';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

interface Deps {
  requestAuthenticator: RequestAuthenticator;
  allowedOrigins: readonly string[];
}

/**
 * Middleware global montado antes de `/api/v1`: resuelve el actor (o `null`) y lo deja en
 * `res.locals.actor` para que `bindRoute` arme el `RequestContext`. Nunca responde 401 aquí:
 * un token desconocido/expirado/revocado es simplemente "sin actor", y cada ruta decide con
 * `requireActor` si eso es un problema.
 */
export function createAuthenticate(deps: Deps): RequestHandler {
  return async (req, res, next) => {
    const bearer = bearerToken(req);
    if (bearer) {
      res.locals.actor = await deps.requestAuthenticator.authenticate(bearer);
      next();
      return;
    }

    // `req.cookies` viene tipado `Record<string, any>` por @types/cookie-parser: se cruza
    // la frontera a `unknown` explícitamente en vez de propagar el `any`.
    const cookies = req.cookies as Record<string, unknown>;
    const cookieToken = cookies[SESSION_COOKIE];
    if (typeof cookieToken !== 'string' || cookieToken === '') {
      res.locals.actor = null;
      next();
      return;
    }

    // Defensa CSRF adicional a SameSite=Lax: una cookie solo autentica una petición que
    // muta estado si el Origin declarado coincide con uno permitido (SameSite=Lax ya bloquea
    // la mayoría de navegación cross-site, pero no cubre todos los casos, p. ej. subdominios).
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.get('origin');
      if (!origin || !deps.allowedOrigins.includes(origin)) {
        res.locals.actor = null;
        next();
        return;
      }
    }

    res.locals.actor = await deps.requestAuthenticator.authenticate(cookieToken);
    next();
  };
}

function bearerToken(req: Request): string | null {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}
