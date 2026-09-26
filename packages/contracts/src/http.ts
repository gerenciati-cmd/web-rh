import type { z } from 'zod';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Definición declarativa de un endpoint. El API la usa para validar la entrada,
 * y el api-client para tipar request/response. Si cambia aquí, cambia en ambos lados.
 */
export interface RouteDefinition {
  readonly method: HttpMethod;
  /** Estilo Express: `/companies/:companyId/employees` */
  readonly path: string;
  readonly summary: string;
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
