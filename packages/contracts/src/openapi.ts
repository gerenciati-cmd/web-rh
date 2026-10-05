import { z } from 'zod';

import { ApiErrorSchema } from './common';
import type { ApiErrorBody } from './common';
import { API_ERRORS, errorRefCode, errorRefVariant } from './errors';
import type { ApiErrorStatus } from './errors';
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
    info: { title: 'API RRHH APS Holding', version: '1', description: introduction() },
    servers: [{ url: '/api/v1' }],
    // Sin `{}`: la sesión es obligatoria salvo en las rutas públicas, que la excluyen con
    // `security: []` a nivel de operación.
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    paths,
    components: {
      schemas: sortedByKey(schemas),
      examples: errorExamples(),
      responses: {
        ValidationError: errorResponse(
          'La solicitud no cumple el contrato (`VALIDATION_ERROR`): indica dónde y qué campos fallan.',
          apiError,
          ['VALIDATION_ERROR'],
        ),
        Unauthenticated: errorResponse(
          'Falta la sesión o ya expiró (`AUTHENTICATION_REQUIRED`).',
          apiError,
          ['AUTHENTICATION_REQUIRED'],
        ),
        Forbidden: errorResponse(
          'La sesión no tiene el permiso que exige la ruta (`FORBIDDEN`).',
          apiError,
          ['FORBIDDEN'],
        ),
        Error: errorResponse('Error inesperado del servidor (`INTERNAL_ERROR`).', apiError, [
          'INTERNAL_ERROR',
        ]),
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
    description: route.description,
    tags: [module],
    ...(route.access.kind === 'public' ? { security: [] } : {}),
    ...(route.access.kind === 'permission'
      ? {
          'x-permission': route.access.permission,
          ...(route.access.companyParam ? { 'x-company-param': route.access.companyParam } : {}),
        }
      : {}),
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
      ...errorResponsesFor(operationId, route, schemas),
      default: { $ref: '#/components/responses/Error' },
    },
  };
}

/**
 * Respuestas de error de una ruta. Las genéricas se derivan de lo que la ruta ya declara (400 si
 * recibe entrada, 401 si exige sesión, 403 si exige permiso); las de dominio salen de `errors`,
 * agrupadas por status. Solo referencias: los cuerpos de ejemplo viven una vez en
 * `components.examples` y las respuestas genéricas una vez en `components.responses`.
 */
function errorResponsesFor(
  operationId: string,
  route: RouteDefinition,
  schemas: Record<string, JsonSchema>,
): Record<string, JsonSchema> {
  const responses: Record<string, JsonSchema> = {};
  if (route.params || route.query || route.body) {
    responses['400'] = { $ref: '#/components/responses/ValidationError' };
  }
  if (route.access.kind !== 'public') {
    responses['401'] = { $ref: '#/components/responses/Unauthenticated' };
  }
  if (route.access.kind === 'permission') {
    responses['403'] = { $ref: '#/components/responses/Forbidden' };
  }

  // Por status: cada entrada es el nombre del ejemplo (`CODE` o `CODE__variante`).
  const codesByStatus = new Map<ApiErrorStatus, string[]>();
  for (const ref of route.errors ?? []) {
    const code = errorRefCode(ref);
    const { status } = API_ERRORS[code];
    codesByStatus.set(status, [
      ...(codesByStatus.get(status) ?? []),
      exampleName(code, errorRefVariant(ref)),
    ]);
  }
  const apiError = toSchema(ApiErrorSchema, 'output', schemas);
  for (const [status, codes] of [...codesByStatus].sort(([a], [b]) => a - b)) {
    if (responses[String(status)]) {
      throw new Error(`OpenAPI: ${operationId} declara errores ${status} que ya se derivan solos`);
    }
    responses[String(status)] = errorResponse(
      codes.map((name) => name.split('__')[0]).join(', '),
      apiError,
      codes,
    );
  }
  return responses;
}

/** Respuesta de error: la forma `ApiError` más un ejemplo POR código, solo como `$ref`. */
function errorResponse(
  description: string,
  apiError: JsonSchema,
  codes: readonly string[],
): JsonSchema {
  return {
    description,
    content: {
      'application/json': {
        schema: apiError,
        examples: Object.fromEntries(
          codes.map((code) => [code, { $ref: `#/components/examples/${code}` }]),
        ),
      },
    },
  };
}

/** Nombre del ejemplo en `components.examples`: el código, o `CODE__variante` si no es el habitual. */
function exampleName(code: string, variant: string): string {
  return variant === 'default' ? code : `${code}__${variant}`;
}

/** Un ejemplo por código y variante del catálogo, emitido una sola vez. */
function errorExamples(): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries(API_ERRORS).flatMap(([code, doc]) =>
      Object.entries<ApiErrorBody>(doc.examples).map(([variant, value]) => {
        const name = exampleName(code, variant);
        return [name, { summary: name, value }];
      }),
    ),
  );
}

/** Portada de la referencia: autenticación, forma del error, paginación y todos los códigos. */
function introduction(): string {
  const rows = Object.entries(API_ERRORS).map(
    ([code, doc]) => `| \`${code}\` | ${doc.status} | ${doc.description} |`,
  );
  return [
    'API de RRHH del holding. Toda la entrada y salida es JSON.',
    '',
    '## Autenticación',
    '',
    'Casi todas las rutas exigen sesión. Para probar aquí: llama a `POST /auth/login` con `client: "mobile"`, copia el `token` de la respuesta y pégalo en **Authentication → bearerAuth**. El cliente web usa una cookie httpOnly en su lugar.',
    '',
    '## Forma de los errores',
    '',
    'Todo error responde `{ "code", "message", "details"? }`. `code` es estable y es lo que debe usar un cliente para decidir qué hacer; `message` está en español y puede cambiar.',
    '',
    '## Paginación',
    '',
    'Los listados aceptan `page` (por defecto 1) y `pageSize` (por defecto 20, máximo 100) y responden `{ items, total, page, pageSize }`.',
    '',
    '## Códigos de error',
    '',
    '| Código | Status | Cuándo ocurre |',
    '| --- | --- | --- |',
    ...rows,
  ].join('\n');
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
    // Scalar muestra la descripción junto al nombre solo si está en el parámetro, no en su esquema.
    ...(typeof property.description === 'string' ? { description: property.description } : {}),
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

/**
 * Orden estable: el archivo versionado no cambia por el orden en que se recorren las rutas.
 * Por punto de código, no `localeCompare`: el orden no debe depender del locale de la máquina/CI.
 */
function sortedByKey(record: Record<string, JsonSchema>): Record<string, JsonSchema> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
