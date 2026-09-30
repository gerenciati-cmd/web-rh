import { z } from 'zod';

import { ApiErrorSchema } from './common';
import type { RouteDefinition } from './http';

type JsonSchema = Record<string, unknown>;
type RouteCatalogue = Readonly<Record<string, Readonly<Record<string, RouteDefinition>>>>;

/** Nombre de la cookie de sesión web (`apps/api/src/http/request-context.ts`). */
const SESSION_COOKIE = '__Host-rrhh_session';

const ZOD_DEFS_PREFIX = '#/$defs/';
const COMPONENT_SCHEMAS_PREFIX = '#/components/schemas/';

/**
 * Documento OpenAPI 3.1 derivado del catálogo de contratos. Puro (sin IO): lo usan el test que
 * mantiene `openapi.json` versionado y el API para servir la referencia interactiva.
 * El catálogo es la fuente de verdad: si una ruta no está en él, no existe en el documento.
 *
 * Los modelos nombrados con `.meta({ id })` en los contratos se emiten UNA vez en
 * `components.schemas` y las rutas los referencian con `$ref` (sin copias en línea).
 */
export function buildOpenApiDocument(routes: RouteCatalogue): JsonSchema {
  const schemas: Record<string, JsonSchema> = {};
  const paths: Record<string, Record<string, JsonSchema>> = {};

  for (const [module, group] of Object.entries(routes)) {
    for (const [operationId, route] of Object.entries(group)) {
      const path = route.path.replace(/:(\w+)/g, '{$1}');
      const method = route.method.toLowerCase();
      paths[path] ??= {};
      // Dos rutas con el mismo método y path se pisarían en silencio: mejor fallar.
      if (paths[path][method]) {
        throw new Error(`OpenAPI: ${route.method} ${route.path} está definida dos veces`);
      }
      paths[path][method] = operationFor(module, operationId, route, schemas);
    }
  }

  const apiError = toSchema(ApiErrorSchema, 'output', schemas);

  return {
    openapi: '3.1.0',
    info: { title: 'API RRHH APS Holding', version: '1' },
    servers: [{ url: '/api/v1' }],
    security: [{ bearerAuth: [] }, { cookieAuth: [] }, {}],
    paths,
    components: {
      schemas: sortedByKey(schemas),
      responses: {
        Error: {
          description:
            'Error con forma `ApiError`: 400 validación, 401 sin sesión, 404 no encontrado, 409 conflicto, 500 inesperado.',
          content: { 'application/json': { schema: apiError } },
        },
      },
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

function operationFor(
  module: string,
  operationId: string,
  route: RouteDefinition,
  schemas: Record<string, JsonSchema>,
): JsonSchema {
  const parameters = [
    ...parametersFrom(route.params, 'path', schemas),
    ...parametersFrom(route.query, 'query', schemas),
  ];
  const status = String(route.successStatus ?? 200);
  const success: JsonSchema =
    status === '204'
      ? { description: route.summary }
      : {
          description: route.summary,
          content: {
            'application/json': { schema: toSchema(route.response, 'output', schemas) },
          },
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
            content: { 'application/json': { schema: toSchema(route.body, 'input', schemas) } },
          },
        }
      : {}),
    responses: {
      [status]: success,
      default: { $ref: '#/components/responses/Error' },
    },
  };
}

/** Un parámetro OpenAPI por cada propiedad del objeto Zod de params/query. */
function parametersFrom(
  schema: z.ZodType | undefined,
  location: 'path' | 'query',
  schemas: Record<string, JsonSchema>,
): JsonSchema[] {
  if (!schema) return [];
  const object = toSchema(schema, 'input', schemas);
  // Un params/query con `.meta({ id })` llegaría como `$ref` sin propiedades: se perderían los
  // parámetros sin aviso.
  if (object.$ref !== undefined) {
    throw new Error(`OpenAPI: los esquemas de ${location} no deben llevar .meta({ id })`);
  }
  const properties = (object.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((object.required ?? []) as string[]);

  return Object.entries(properties).map(([name, property]) => ({
    name,
    in: location,
    required: location === 'path' || required.has(name),
    schema: property,
  }));
}

/**
 * Convierte con Zod y mueve sus `$defs` (los modelos nombrados) a `components.schemas`,
 * reescribiendo las referencias. `io`: lo que el cliente ENVÍA (input) o RECIBE (output).
 */
function toSchema(
  schema: z.ZodType,
  io: 'input' | 'output',
  schemas: Record<string, JsonSchema>,
): JsonSchema {
  const {
    $schema: _dialect,
    $defs,
    ...rest
  } = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema & {
    $defs?: Record<string, JsonSchema>;
  };

  for (const [id, def] of Object.entries($defs ?? {})) {
    // Zod nombra `__schemaN` lo que extrae sin id (ciclos, reuso): no es estable entre rutas.
    if (id.startsWith('__')) {
      throw new Error(`OpenAPI: esquema extraído sin nombre (${id}); nómbralo con .meta({ id })`);
    }
    const hoisted = rewriteRefs(def) as JsonSchema;
    const existing = schemas[id];
    if (existing && JSON.stringify(existing) !== JSON.stringify(hoisted)) {
      throw new Error(`OpenAPI: el modelo "${id}" tiene dos formas distintas (¿input vs output?)`);
    }
    schemas[id] = hoisted;
  }
  return rewriteRefs(rest) as JsonSchema;
}

function rewriteRefs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteRefs);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) =>
      key === '$ref' && typeof inner === 'string' && inner.startsWith(ZOD_DEFS_PREFIX)
        ? [key, COMPONENT_SCHEMAS_PREFIX + inner.slice(ZOD_DEFS_PREFIX.length)]
        : [key, rewriteRefs(inner)],
    ),
  );
}

/** Orden estable: el archivo versionado no cambia por el orden en que se recorren las rutas. */
function sortedByKey(record: Record<string, JsonSchema>): Record<string, JsonSchema> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}
