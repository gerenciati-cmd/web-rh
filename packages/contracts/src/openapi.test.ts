import { describe, expect, it } from 'vitest';

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
    expect(operationIds).toHaveLength(8);
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
    expect(document.security).toEqual([{ bearerAuth: [] }, { cookieAuth: [] }, {}]);
  });

  it('cada operación referencia ApiError en los códigos de error declarados', () => {
    const createCompany = document.paths['/companies']?.post;
    for (const code of ['400', '401', '404', '409', '500']) {
      expect(createCompany?.responses[code]).toMatchObject({
        content: {
          'application/json': { schema: { $ref: '#/components/schemas/ApiError' } },
        },
      });
    }
  });
});
