import { describe, expect, it, vi } from 'vitest';

import { buildUrl, createApiClient } from './client';
import { type ApiError } from './errors';

const COMPANY_ID = '0b9a4a5e-7f53-4c55-9d2b-2b1c3f1e8a10';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('buildUrl', () => {
  it('reemplaza parámetros y agrega query sin undefined', () => {
    expect(
      buildUrl(
        'http://api/',
        '/companies/:companyId/employees',
        { companyId: 'a b' },
        {
          page: 2,
          search: undefined,
        },
      ),
    ).toBe('http://api/companies/a%20b/employees?page=2');
  });
});

describe('createApiClient', () => {
  it('envía el token y valida la respuesta según el contrato', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(201, { id: COMPANY_ID }));
    const client = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: () => 'secret',
      fetch: fetchMock,
    });

    const result = await client.organization.createCompany({
      body: { legalName: 'APS Holding', taxId: 'EKU9003173C9', country: 'MX' },
    });

    expect(result.id).toBe(COMPANY_ID);
    const [, init] = fetchMock.mock.calls[0]!;
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret');
  });

  it('traduce errores al ApiError con code estable', async () => {
    const client = createApiClient({
      baseUrl: 'http://api',
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse(404, { code: 'COMPANY_NOT_FOUND', message: 'No existe' })),
    });

    await expect(
      client.organization.getCompany({ params: { companyId: COMPANY_ID } }),
    ).rejects.toMatchObject({ status: 404, code: 'COMPANY_NOT_FOUND' } satisfies Partial<ApiError>);
  });
});
