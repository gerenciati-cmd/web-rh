import type { ParsedRequest, RouteDefinition, RouteResponse } from '@rrhh/contracts';
import type { DomainError, Result } from '@rrhh/domain';
import type { Router } from 'express';
import type { z } from 'zod';

import { RequestValidationError } from './request-validation-error';

export type RouteHandler<R extends RouteDefinition> = (
  request: ParsedRequest<R>,
) => Promise<RouteResponse<R>>;

/**
 * Enlaza una ruta del contrato con su handler. Centraliza (DRY) lo que todo endpoint
 * repetiría: validar params/query/body, responder con el status correcto y
 * (fuera de producción) verificar que la respuesta cumple el contrato.
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

    const output = await handler(parsed);

    if (process.env.NODE_ENV !== 'production') route.response.parse(output);

    const status = route.successStatus ?? 200;
    if (status === 204) res.status(204).end();
    else res.status(status).json(output);
  });
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
