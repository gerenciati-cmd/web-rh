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
    expect(operationIds).toHaveLength(19);
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
    expect(createCompany.responses).not.toHaveProperty('400');
    expect(createCompany.responses).not.toHaveProperty('401');
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
          access: authenticated,
          response: z.string(),
        }),
      },
      moduleB: {
        two: defineRoute({
          method: 'GET',
          path: '/duplicated',
          summary: 'Segunda',
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
          access: authenticated,
          response: dupA,
        }),
        two: defineRoute({
          method: 'GET',
          path: '/dup-b',
          summary: 's',
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
          access: authenticated,
          response: lower,
        }),
        two: defineRoute({
          method: 'GET',
          path: '/order-b',
          summary: 's',
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
