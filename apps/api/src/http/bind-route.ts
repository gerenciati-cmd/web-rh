import type { ParsedRequest, RouteAccess, RouteDefinition, RouteResponse } from '@rrhh/contracts';
import type { DomainError, Result } from '@rrhh/domain';
import type { Router } from 'express';
import type { z } from 'zod';

import { hasPermission, type Actor } from '@/shared/application/actor';

import { PermissionDeniedError, requireActor, type RequestContext } from './request-context';
import { RequestValidationError } from './request-validation-error';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Puesto por el middleware de autenticación (`src/http/authenticate.ts`) antes de esta capa. */
      actor: Actor | null;
    }
  }
}

export type RouteHandler<R extends RouteDefinition> = (
  request: ParsedRequest<R>,
  context: RequestContext,
) => Promise<RouteResponse<R>>;

const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: 'lax' as const, path: '/' };

/**
 * Enlaza una ruta del contrato con su handler. Centraliza (DRY) lo que todo endpoint
 * repetiría: validar params/query/body, armar el contexto de la petición, responder con el
 * status correcto y (fuera de producción) verificar que la respuesta cumple el contrato.
 */
export function bindRoute<R extends RouteDefinition>(
  router: Router,
  route: R,
  handler: RouteHandler<R>,
): void {
  const method = route.method.toLowerCase() as Lowercase<R['method']>;

  router[method](route.path, async (req, res) => {
    const parsed = {
      params: parsePart(route.params, req.params, 'params'),
      query: parsePart(route.query, req.query, 'query'),
      body: parsePart(route.body, req.body, 'body'),
    } as ParsedRequest<R>;

    const context: RequestContext = {
      actor: res.locals.actor ?? null,
      client: { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null },
      cookies: {
        set: (name, value, expires) => res.cookie(name, value, { ...COOKIE_OPTIONS, expires }),
        clear: (name) => res.clearCookie(name, COOKIE_OPTIONS),
      },
    };

    authorize(route.access, parsed.params, context);

    const output = await handler(parsed, context);

    if (process.env.NODE_ENV !== 'production') route.response.parse(output);

    const status = route.successStatus ?? 200;
    if (status === 204) res.status(204).end();
    else res.status(status).json(output);
  });
}

/**
 * Aplica el acceso declarado en el contrato (negado por defecto, ADR 0012). Se lanza 403 aun si
 * la empresa no existe: quien no tiene alcance sobre ella no puede sondear cuáles existen.
 */
function authorize(access: RouteAccess, params: unknown, context: RequestContext): void {
  if (access.kind === 'public') return;

  const actor = requireActor(context);
  if (access.kind === 'authenticated') return;

  if (access.companyParam === undefined) {
    if (!hasPermission(actor, access.permission)) throw new PermissionDeniedError();
    return;
  }

  const companyId = (params as Record<string, unknown> | undefined)?.[access.companyParam];
  if (typeof companyId !== 'string') {
    // Un contrato que nombra un parámetro inexistente es un error de programación, no del cliente.
    throw new Error(`La ruta declara companyParam "${access.companyParam}" que no está en params`);
  }
  if (!hasPermission(actor, access.permission, companyId)) throw new PermissionDeniedError();
}

function parsePart(
  schema: z.ZodType | undefined,
  value: unknown,
  location: RequestValidationError['location'],
): unknown {
  if (!schema) return undefined;
  const result = schema.safeParse(value);
  if (!result.success) throw new RequestValidationError(location, result.error.issues);
  return result.data;
}

/** Convierte un Result de un command en valor o lanza el error de dominio (lo mapea el error handler). */
export function unwrap<T>(result: Result<T, DomainError>): T {
  if (!result.ok) throw result.error;
  return result.value;
}
