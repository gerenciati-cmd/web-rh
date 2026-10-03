import type { Permission } from '@rrhh/domain';
import type { z } from 'zod';

import type { ApiErrorCode } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Quién puede llamar a una ruta. Ver `RouteDefinition.access`. */
export type RouteAccess =
  | { readonly kind: 'public' }
  | { readonly kind: 'authenticated' }
  | {
      readonly kind: 'permission';
      readonly permission: Permission;
      readonly companyParam?: string;
    };

export const publicAccess: RouteAccess = { kind: 'public' };
export const authenticated: RouteAccess = { kind: 'authenticated' };
export const requires = (
  permission: Permission,
  options?: { companyParam: string },
): RouteAccess =>
  options
    ? { kind: 'permission', permission, companyParam: options.companyParam }
    : { kind: 'permission', permission };

/**
 * Definición declarativa de un endpoint. El API la usa para validar la entrada,
 * y el api-client para tipar request/response. Si cambia aquí, cambia en ambos lados.
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  /** Estilo Express: `/companies/:companyId/employees` */
  readonly path: string;
  readonly summary: string;
  /**
   * Explicación en markdown para la referencia de la API: qué hace, quién puede llamarla, qué
   * necesita y qué efectos tiene.
   */
  readonly description: string;
  /**
   * Códigos de error de dominio que la ruta puede devolver (404, 409, 422, 429). Los genéricos
   * 400, 401 y 403 se derivan de lo que la ruta ya declara (entrada y acceso).
   */
  readonly errors?: readonly ApiErrorCode[];
  /**
   * Negado por defecto: toda ruta declara quién la puede llamar. `companyParam` nombra el
   * parámetro de path cuya empresa debe estar en el alcance del actor.
   */
  readonly access: RouteAccess;
  readonly params?: z.ZodType;
  readonly query?: z.ZodType;
  readonly body?: z.ZodType;
  readonly response: z.ZodType;
  readonly successStatus?: 200 | 201 | 204;
}

/** Identidad tipada: conserva los tipos literales de la ruta para inferencia. */
export const defineRoute = <const R extends RouteDefinition>(route: R): R => route;

type RequestPart<
  R extends RouteDefinition,
  K extends 'params' | 'query' | 'body',
> = R[K] extends z.ZodType ? Record<K, z.input<R[K]>> : Partial<Record<K, never>>;

/** Lo que el cliente debe enviar para llamar a la ruta `R`. */
export type RouteRequest<R extends RouteDefinition> = RequestPart<R, 'params'> &
  RequestPart<R, 'query'> &
  RequestPart<R, 'body'>;

/** Lo que el servidor recibe ya validado y transformado por Zod. */
export interface ParsedRequest<R extends RouteDefinition> {
  params: R['params'] extends z.ZodType ? z.output<R['params']> : undefined;
  query: R['query'] extends z.ZodType ? z.output<R['query']> : undefined;
  body: R['body'] extends z.ZodType ? z.output<R['body']> : undefined;
}

export type RouteResponse<R extends RouteDefinition> = z.output<R['response']>;
