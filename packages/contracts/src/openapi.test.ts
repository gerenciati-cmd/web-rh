import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { RouteDefinition } from './http';
import { authenticated, defineRoute } from './http';
import { apiRoutes, buildOpenApiDocument } from './index';

// `openapi.json` versionado: si cambia un contrato sin regenerarlo, este test falla en
// `pnpm check`. Regenerar: `pnpm --filter @rrhh/contracts openapi`.
it('openapi.json está al día con los contratos', async () => {
  const document = `${JSON.stringify(buildOpenApiDocument(apiRoutes), null, 2)}\n`;
  await expect(document).toMatchFileSnapshot('../openapi.json');
});

/**
 * Comportamiento del generador (`openapi.ts`), no del archivo versionado: éstos verifican la
 * FORMA del documento contra el catálogo real `apiRoutes` (8 operaciones: organization×3,
 * employees×2, identity×3 — `company.contract.ts`, `employee.contract.ts`, `auth.contract.ts`).
 */
type JsonSchema = Record<string, unknown>;
interface OperationParameter {
  name: string;
  in: string;
  required?: boolean;
}
interface Operation {
  operationId?: string;
  parameters?: OperationParameter[];
  responses: Record<string, JsonSchema>;
}

describe('buildOpenApiDocument', () => {
  const document = buildOpenApiDocument(apiRoutes) as {
    paths: Record<string, Record<string, Operation>>;
    components: {
      schemas: Record<string, unknown>;
      securitySchemes: Record<string, { type: string }>;
    };
    security: unknown[];
  };

  it('incluye una operación por cada ruta de las 3 catálogos del módulo', () => {
    const operationIds = Object.values(document.paths).flatMap((methods) =>
      Object.values(methods).map((operation) => operation.operationId),
    );
    const expected = Object.values(apiRoutes).flatMap((group) => Object.keys(group));

    expect(operationIds.sort()).toEqual(expected.sort());
    expect(operationIds).toHaveLength(30);
  });

  it('convierte los segmentos :param de Express a {param} de OpenAPI', () => {
    expect(document.paths).toHaveProperty('/companies/{companyId}');
    expect(document.paths).not.toHaveProperty('/companies/:companyId');
  });

  it('emite un parámetro path por cada propiedad de params, marcado required', () => {
    const getCompany = document.paths['/companies/{companyId}']?.get;
    expect(getCompany?.parameters).toEqual([
      expect.objectContaining({ name: 'companyId', in: 'path', required: true }),
    ]);
  });

  it('emite parámetros query desde PageQuerySchema (con default, no required)', () => {
    const listCompanies = document.paths['/companies']?.get;
    const names = (listCompanies?.parameters ?? []).map((p) => p.name);
    expect(names.sort()).toEqual(['page', 'pageSize']);
    expect(listCompanies?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'page', in: 'query' })]),
    );
  });

  it('logOut (204) no lleva content en la respuesta de éxito', () => {
    const logOut = document.paths['/auth/logout']?.post;
    expect(logOut?.responses).toHaveProperty('204');
    expect(logOut?.responses['204']).not.toHaveProperty('content');
  });

  it('las respuestas de éxito con cuerpo sí llevan content application/json', () => {
    const logIn = document.paths['/auth/login']?.post;
    expect(logIn?.responses['200']).toHaveProperty('content.application/json.schema');
  });

  it('declara los dos esquemas de seguridad y ApiError en components', () => {
    expect(document.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(document.components.securitySchemes.cookieAuth).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-rrhh_session',
    });
    expect(document.components.schemas.ApiError).toBeDefined();
    expect(document.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }]);
  });

  // Ronda de reparación 1 (README decisión 6): las 5 respuestas de error por operación se
  // reemplazaron por una sola `components.responses.Error`, referenciada como `default`
  // (`openapi.ts:110-113`). Reemplaza el test anterior, que esperaba 400/401/404/409/500 por
  // operación (comportamiento ya no vigente).
  it('cada operación referencia components.responses.Error como respuesta default', () => {
    const createCompany = document.paths['/companies']?.post as {
      responses: Record<string, unknown>;
    };
    expect(createCompany.responses.default).toEqual({ $ref: '#/components/responses/Error' });
    // Plan platform-openapi/002: 400/401/403 se derivan de lo que la ruta declara, pero como
    // `$ref` a components.responses (no copias en línea).
    expect(createCompany.responses['400']).toEqual({
      $ref: '#/components/responses/ValidationError',
    });
    expect(createCompany.responses['401']).toEqual({
      $ref: '#/components/responses/Unauthenticated',
    });
  });

  it('components.responses.Error referencia components.schemas.ApiError', () => {
    const errorResponse = (
      document as unknown as {
        components: { responses: { Error: { content: Record<string, unknown> } } };
      }
    ).components.responses.Error;
    expect(errorResponse.content).toMatchObject({
      'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
    });
  });

  it('los modelos nombrados con .meta({ id }) del catálogo real quedan en components.schemas, sin copias en línea', () => {
    for (const id of [
      'ApiError',
      'Created',
      'Company',
      'CreateCompanyInput',
      'EmployeeListItem',
      'RegisterEmployeeInput',
      'SessionUser',
      'LogInInput',
      'LogInResponse',
    ]) {
      expect(document.components.schemas[id]).toBeDefined();
    }
    const createCompanyBody = (
      document.paths['/companies']?.post as unknown as {
        requestBody: { content: { 'application/json': { schema: unknown } } };
      }
    ).requestBody.content['application/json'].schema;
    expect(createCompanyBody).toEqual({ $ref: '#/components/schemas/CreateCompanyInput' });
  });
});

/**
 * Casos límite del generador que la revisión pidió cubrir (hallazgos 2 y 3, ronda de
 * reparación 1): los `throw` de `openapi.ts` ante catálogos inválidos. Cada catálogo es
 * mínimo y ad hoc — no viene de `apiRoutes` real — porque el propósito es forzar la condición,
 * no describir una ruta real del producto.
 */
describe('buildOpenApiDocument — catálogos inválidos (finding 2 y 3 de la revisión)', () => {
  type Catalogue = Readonly<Record<string, Readonly<Record<string, RouteDefinition>>>>;

  it('lanza si dos rutas del catálogo comparten método y path', () => {
    const duplicated: Catalogue = {
      moduleA: {
        one: defineRoute({
          method: 'GET',
          path: '/duplicated',
          summary: 'Primera',
          description: 'Descripción de prueba',
          access: authenticated,
          response: z.string(),
        }),
      },
      moduleB: {
        two: defineRoute({
          method: 'GET',
          path: '/duplicated',
          summary: 'Segunda',
          description: 'Descripción de prueba',
          access: authenticated,
          response: z.string(),
        }),
      },
    };

    expect(() => buildOpenApiDocument(duplicated)).toThrow(/está definida dos veces/);
  });

  it('lanza si Zod extrae un $def anónimo (esquema recursivo sin .meta({ id }))', () => {
    // Un esquema que se referencia a sí mismo en una posición que no es la raíz obliga a Zod a
    // hoistearlo a `$defs` con un id arbitrario (`__schema0`) cuando no tiene `.meta({ id })`.
    const nodeSchema: z.ZodType = z.lazy(() => z.object({ value: z.string(), next: nodeSchema }));
    const wrapper = z.object({ a: nodeSchema, b: nodeSchema });
    const anonymous: Catalogue = {
      moduleA: {
        one: defineRoute({
          method: 'GET',
          path: '/anonymous',
          summary: 'Recursivo sin nombre',
          description: 'Descripción de prueba',
          access: authenticated,
          response: wrapper,
        }),
      },
    };

    expect(() => buildOpenApiDocument(anonymous)).toThrow(/esquema extraído sin nombre/);
  });

  it('lanza si dos modelos usan el mismo .meta({ id }) con formas distintas', () => {
    const dupA = z.object({ x: z.string() }).meta({ id: 'Dup' });
    const dupB = z.object({ y: z.number() }).meta({ id: 'Dup' });
    const collision: Catalogue = {
      moduleA: {
        one: defineRoute({
          method: 'GET',
          path: '/dup-a',
          summary: 's',
          description: 'Descripción de prueba',
          access: authenticated,
          response: dupA,
        }),
        two: defineRoute({
          method: 'GET',
          path: '/dup-b',
          summary: 's',
          description: 'Descripción de prueba',
          access: authenticated,
          response: dupB,
        }),
      },
    };

    expect(() => buildOpenApiDocument(collision)).toThrow(/tiene dos formas distintas/);
  });

  it('lanza si un esquema de params/query lleva .meta({ id }) (se perdería como $ref)', () => {
    const namedParams = z.object({ companyId: z.uuid() }).meta({ id: 'NamedParams' });
    const badParams: Catalogue = {
      moduleA: {
        one: defineRoute({
          method: 'GET',
          path: '/named-params/:companyId',
          summary: 's',
          description: 'Descripción de prueba',
          access: authenticated,
          params: namedParams,
          response: z.string(),
        }),
      },
    };

    expect(() => buildOpenApiDocument(badParams)).toThrow(
      /los esquemas de path no deben llevar \.meta\(\{ id \}\)/,
    );
  });
});

/**
 * Info 3 de la revisión (ronda de reparación 1) y cerrado en la ronda 2: `components.schemas`
 * se ordena por punto de código, no por `localeCompare`, para que el archivo versionado no
 * dependa del locale de la máquina/CI (`openapi.ts:189-193`, `sortedByKey`). `sortedByKey` no
 * se exporta, así que se prueba a través del documento: se eligen ids ('aaa' minúscula,
 * 'Bbb' con mayúscula inicial) donde ambos órdenes divergen de verdad — comprobado antes de
 * escribir la aserción con un script aparte, no adivinado:
 *   ['aaa','Bbb'].sort(localeCompare)      → ['aaa', 'Bbb']  (case-insensitive: a antes que B)
 *   ['aaa','Bbb'].sort(código de punto)    → ['Bbb', 'aaa']  ('B'=66 < 'a'=97)
 * Si `sortedByKey` volviera a `localeCompare`, este test fallaría.
 */
describe('buildOpenApiDocument — orden de components.schemas (info 3, ronda de reparación 2)', () => {
  it('ordena components.schemas por punto de código (case-sensitive), no por localeCompare', () => {
    type Catalogue = Readonly<Record<string, Readonly<Record<string, RouteDefinition>>>>;
    const lower = z.object({ x: z.string() }).meta({ id: 'aaa' });
    const upper = z.object({ y: z.number() }).meta({ id: 'Bbb' });
    const catalogue: Catalogue = {
      moduleA: {
        one: defineRoute({
          method: 'GET',
          path: '/order-a',
          summary: 's',
          description: 'Descripción de prueba',
          access: authenticated,
          response: lower,
        }),
        two: defineRoute({
          method: 'GET',
          path: '/order-b',
          summary: 's',
          description: 'Descripción de prueba',
          access: authenticated,
          response: upper,
        }),
      },
    };

    const document = buildOpenApiDocument(catalogue) as {
      components: { schemas: Record<string, unknown> };
    };

    // `ApiError` (build siempre lo agrega) siempre entra: por punto de código 'A' (65) < 'B'
    // (66) < 'a' (97), así que queda antes que ambos. Entre los dos ids del catálogo ad hoc,
    // 'Bbb' (66) va antes que 'aaa' (97). Un `localeCompare` case-insensitive daría
    // ['aaa', 'ApiError', 'Bbb'] (comprobado aparte) en vez de este orden.
    expect(Object.keys(document.components.schemas)).toEqual(['ApiError', 'Bbb', 'aaa']);
  });
});

/**
 * Plan platform-openapi/002: descripción por operación, errores derivados y declarados, y
 * ejemplos emitidos una sola vez (`components.examples`) con las operaciones solo por `$ref`.
 */
describe('buildOpenApiDocument — documentación por endpoint y errores', () => {
  interface DocumentedOperation {
    description?: string;
    parameters?: { name: string; description?: string }[];
    responses: Record<
      string,
      {
        $ref?: string;
        description?: string;
        content?: { 'application/json': { examples?: Record<string, unknown> } };
      }
    >;
  }
  const document = buildOpenApiDocument(apiRoutes) as unknown as {
    info: { description: string };
    paths: Record<string, Record<string, DocumentedOperation>>;
    components: {
      examples: Record<string, { summary: string; value: { code: string } }>;
      responses: Record<string, unknown>;
    };
  };
  const operations = Object.entries(document.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({ path, method, operation })),
  );

  it('toda operación lleva una descripción no vacía', () => {
    for (const { path, method, operation } of operations) {
      expect(operation.description?.trim(), `${method} ${path}`).toBeTruthy();
    }
  });

  it('los ejemplos de error solo viven en components.examples: las operaciones usan $ref', () => {
    const inline = JSON.stringify(document.paths);
    // Un ejemplo en línea llevaría `value`; las referencias solo `$ref`.
    expect(inline).not.toContain('"value"');
    expect(inline).not.toContain('"example"');
    for (const { operation } of operations) {
      for (const response of Object.values(operation.responses)) {
        for (const example of Object.values(
          response.content?.['application/json'].examples ?? {},
        )) {
          expect(Object.keys(example as object)).toEqual(['$ref']);
        }
      }
    }
  });

  it('todo código declarado por una ruta existe en components.examples', () => {
    for (const group of Object.values(apiRoutes)) {
      for (const route of Object.values(group) as RouteDefinition[]) {
        for (const ref of route.errors ?? []) {
          const name = typeof ref === 'string' ? ref : `${ref.code}__${ref.variant}`;
          expect(document.components.examples).toHaveProperty([name]);
        }
      }
    }
  });

  it('deriva 400/401/403 de lo que la ruta declara', () => {
    const assignSite =
      document.paths['/companies/{companyId}/employees/{employeeId}/site']?.put?.responses;
    expect(Object.keys(assignSite ?? {})).toEqual(
      expect.arrayContaining(['204', '400', '401', '403', '404', '422', 'default']),
    );
    expect(assignSite?.['400']).toEqual({ $ref: '#/components/responses/ValidationError' });
    expect(assignSite?.['401']).toEqual({ $ref: '#/components/responses/Unauthenticated' });
    expect(assignSite?.['403']).toEqual({ $ref: '#/components/responses/Forbidden' });
  });

  it('una ruta pública no deriva 401/403; el 401 es el declarado (credenciales)', () => {
    const logIn = document.paths['/auth/login']?.post?.responses;
    expect(logIn?.['401']?.description).toBe('INVALID_CREDENTIALS');
    expect(logIn).not.toHaveProperty('403');
  });

  it('una ruta autenticada sin entrada ni permiso solo deriva 401', () => {
    const me = document.paths['/auth/me']?.get?.responses;
    expect(me).not.toHaveProperty('400');
    expect(me).not.toHaveProperty('403');
    expect(me?.['401']).toEqual({ $ref: '#/components/responses/Unauthenticated' });
  });

  it('agrupa los errores declarados por status, con un ejemplo por código', () => {
    const responses =
      document.paths['/companies/{companyId}/employees/{employeeId}/site']?.put?.responses;
    expect(responses?.['404']?.description).toBe(
      'EMPLOYEE_NOT_FOUND, SITE_NOT_FOUND, COMPANY_NOT_FOUND',
    );
    expect(responses?.['404']?.content?.['application/json'].examples).toEqual({
      EMPLOYEE_NOT_FOUND: { $ref: '#/components/examples/EMPLOYEE_NOT_FOUND' },
      SITE_NOT_FOUND: { $ref: '#/components/examples/SITE_NOT_FOUND' },
      COMPANY_NOT_FOUND: { $ref: '#/components/examples/COMPANY_NOT_FOUND' },
    });
    expect(responses?.['422']?.description).toBe('SITE_INACTIVE, SITE_COUNTRY_MISMATCH');
  });

  it('una ruta con variante referencia el ejemplo de esa variante y el catálogo lo emite una vez', () => {
    const assign = document.paths['/users/{userId}/role-assignments']?.post?.responses;
    expect(
      assign?.['422']?.content?.['application/json'].examples?.COMPANY_INACTIVE__role_assignment,
    ).toEqual({
      $ref: '#/components/examples/COMPANY_INACTIVE__role_assignment',
    });
    expect(document.components.examples).toHaveProperty('COMPANY_INACTIVE');
    expect(document.components.examples).toHaveProperty('COMPANY_INACTIVE__role_assignment');
  });

  it('copia la descripción del esquema al parámetro', () => {
    const parameters = document.paths['/attendance/punches']?.get?.parameters ?? [];
    expect(parameters.find((p) => p.name === 'page')?.description).toMatch(/por defecto 1/);
    expect(parameters.find((p) => p.name === 'from')?.description).toMatch(/^Opcional/);
  });

  it('la portada explica autenticación, forma del error, paginación y lista cada código', () => {
    expect(document.info.description).toMatch(/Autenticación/);
    expect(document.info.description).toMatch(/Paginación/);
    // Las variantes (`CODE__variante`) comparten fila con su código.
    for (const name of Object.keys(document.components.examples)) {
      expect(document.info.description).toContain(`\`${name.split('__')[0]}\``);
    }
  });

  // Plan platform-observabilidad/001: errores del parser de cuerpo (no los declara ninguna ruta,
  // viven solo en el catálogo; el handler los devuelve en `error-handler.ts`).
  it('el catálogo emite MALFORMED_JSON (400) y PAYLOAD_TOO_LARGE (413) en ejemplos y portada', () => {
    expect(document.components.examples.MALFORMED_JSON?.value).toEqual({
      code: 'MALFORMED_JSON',
      message: 'El cuerpo de la petición no es JSON válido',
    });
    expect(document.components.examples.PAYLOAD_TOO_LARGE?.value).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'El cuerpo de la petición supera el tamaño permitido',
    });
    expect(document.info.description).toMatch(/\| `MALFORMED_JSON` \| 400 \|/);
    expect(document.info.description).toMatch(/\| `PAYLOAD_TOO_LARGE` \| 413 \|/);
  });

  it('lanza si una ruta declara un error con un status que ya se deriva solo', () => {
    const clash: RouteDefinition = defineRoute({
      method: 'GET',
      path: '/clash',
      summary: 's',
      description: 'd',
      errors: ['AUTHENTICATION_REQUIRED'],
      access: authenticated,
      response: z.string(),
    });
    expect(() => buildOpenApiDocument({ moduleA: { clash } })).toThrow(/ya se derivan solos/);
  });
});
