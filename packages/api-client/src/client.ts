import {
  ApiErrorSchema,
  apiRoutes,
  type RouteDefinition,
  type RouteRequest,
  type RouteResponse,
} from '@rrhh/contracts';

import { ApiError } from './errors';

export interface ApiClientOptions {
  baseUrl: string;
  /**
   * Inversión de dependencias: el cliente no sabe DÓNDE vive el token.
   * Web lo lee de cookies/sesión, mobile de SecureStore.
   */
  getAccessToken?: () => string | null | Promise<string | null>;
  /** Inyectable para tests o para runtimes con fetch propio. */
  fetch?: typeof fetch;
}

/** Si la ruta no requiere nada, el argumento es opcional. */
type EndpointArgs<R extends RouteDefinition> =
  object extends RouteRequest<R> ? [request?: RouteRequest<R>] : [request: RouteRequest<R>];

export type Endpoint<R extends RouteDefinition> = (
  ...args: EndpointArgs<R>
) => Promise<RouteResponse<R>>;

type RouteGroups = Record<string, Record<string, RouteDefinition>>;

type ClientOf<T extends RouteGroups> = {
  [Group in keyof T]: { [Name in keyof T[Group]]: Endpoint<T[Group][Name]> };
};

export type ApiClient = ClientOf<typeof apiRoutes>;

/**
 * Crea el cliente a partir del catálogo de rutas. Agregar un endpoint en
 * `@rrhh/contracts` lo expone aquí automáticamente, tipado de punta a punta.
 */
export function createApiClient(options: ApiClientOptions): ApiClient {
  const call = createCaller(options);
  const client: Record<string, Record<string, unknown>> = {};

  for (const [groupName, routes] of Object.entries(apiRoutes as RouteGroups)) {
    const group: Record<string, unknown> = {};
    for (const [routeName, route] of Object.entries(routes)) {
      group[routeName] = (request?: Partial<Record<'params' | 'query' | 'body', unknown>>) =>
        call(route, request ?? {});
    }
    client[groupName] = group;
  }

  return client as ApiClient;
}

function createCaller({ baseUrl, getAccessToken, fetch: fetchImpl = fetch }: ApiClientOptions) {
  return async (
    route: RouteDefinition,
    request: Partial<Record<'params' | 'query' | 'body', unknown>>,
  ): Promise<unknown> => {
    const url = buildUrl(baseUrl, route.path, request.params, request.query);
    const token = await getAccessToken?.();

    const response = await fetchImpl(url, {
      method: route.method,
      headers: {
        Accept: 'application/json',
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
    });

    if (!response.ok) throw await toApiError(response);
    if (response.status === 204) return undefined;

    // Validar la respuesta detecta a tiempo que cliente y servidor quedaron desalineados.
    return route.response.parse(await response.json());
  };
}

/** Params y query son planos por contrato: solo primitivos. */
type Primitive = string | number | boolean;

export function buildUrl(baseUrl: string, path: string, params?: unknown, query?: unknown): string {
  const resolvedPath = path.replace(/:(\w+)/g, (_, key: string) => {
    const value = (params as Record<string, Primitive | undefined> | undefined)?.[key];
    if (value === undefined) throw new Error(`Falta el parámetro de ruta "${key}"`);
    return encodeURIComponent(String(value));
  });

  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(
    (query ?? {}) as Record<string, Primitive | null | undefined>,
  )) {
    if (value !== undefined && value !== null) search.append(key, String(value));
  }
  const qs = search.toString();

  return `${baseUrl.replace(/\/$/, '')}${resolvedPath}${qs ? `?${qs}` : ''}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  return parsed.success
    ? new ApiError(response.status, parsed.data.code, parsed.data.message, parsed.data.details)
    : new ApiError(response.status, 'UNKNOWN_ERROR', response.statusText);
}
