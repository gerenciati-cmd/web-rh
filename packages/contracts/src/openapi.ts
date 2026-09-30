import { z } from 'zod';

import { ApiErrorSchema } from './common';
import type { RouteDefinition } from './http';

type JsonSchema = Record<string, unknown>;
type RouteCatalogue = Readonly<Record<string, Readonly<Record<string, RouteDefinition>>>>;

/** Nombre de la cookie de sesión web (`apps/api/src/http/request-context.ts`). */
const SESSION_COOKIE = '__Host-rrhh_session';

const ERROR_STATUSES = ['400', '401', '404', '409', '500'] as const;

/**
 * Documento OpenAPI 3.1 derivado del catálogo de contratos. Puro (sin IO): lo usan el test que
 * mantiene `openapi.json` versionado y el API para servir la referencia interactiva.
 * El catálogo es la fuente de verdad: si una ruta no está en él, no existe en el documento.
 */
export function buildOpenApiDocument(routes: RouteCatalogue): JsonSchema {
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const [module, group] of Object.entries(routes)) {
    for (const [operationId, route] of Object.entries(group)) {
      const path = route.path.replace(/:(\w+)/g, '{$1}');
      paths[path] ??= {};
      paths[path][route.method.toLowerCase()] = operationFor(module, operationId, route);
    }
  }

  return {
    openapi: '3.1.0',
    info: { title: 'API RRHH APS Holding', version: '1' },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
    paths,
    components: {
      schemas: { ApiError: toSchema(ApiErrorSchema, 'output') },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Token de sesión móvil: inicia sesión con `client: "mobile"` y pega el `token` de la respuesta.',
        },
        cookieAuth: {
          type: 'apiKey',
          in: 'cookie',
          name: SESSION_COOKIE,
          description:
            'Sesión web: inicia sesión con `client: "web"`; el navegador guarda la cookie httpOnly.',
        },
      },
    },
  };
}

function operationFor(module: string, operationId: string, route: RouteDefinition): JsonSchema {
  const parameters = [
    ...parametersFrom(route.params, 'path'),
    ...parametersFrom(route.query, 'query'),
  ];
  const status = String(route.successStatus ?? 200);
  const success: JsonSchema =
    status === '204'
      ? { description: route.summary }
      : {
          description: route.summary,
          content: { 'application/json': { schema: toSchema(route.response, 'output') } },
        };

  return {
    operationId,
    summary: route.summary,
    tags: [module],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: toSchema(route.body, 'input') } },
          },
        }
      : {}),
    responses: {
      [status]: success,
      ...Object.fromEntries(
        ERROR_STATUSES.map((code) => [
          code,
          {
            description: 'Error',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
            },
          },
        ]),
      ),
    },
  };
}

/** Un parámetro OpenAPI por cada propiedad del objeto Zod de params/query. */
function parametersFrom(schema: z.ZodType | undefined, location: 'path' | 'query'): JsonSchema[] {
  if (!schema) return [];
  const object = toSchema(schema, 'input');
  const properties = (object.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((object.required ?? []) as string[]);

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

/** `io`: lo que el cliente ENVÍA (input) o RECIBE (output), que difieren con defaults/coerce. */
function toSchema(schema: z.ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return rest;
}
