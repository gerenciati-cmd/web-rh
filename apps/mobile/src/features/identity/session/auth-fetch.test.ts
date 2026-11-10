import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authFetch, setUnauthorizedHandler } from './auth-fetch';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  setUnauthorizedHandler(null);
  vi.unstubAllGlobals();
});

describe('authFetch', () => {
  it('avisa al handler ante un 401 con Authorization y devuelve la respuesta intacta', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const response = new Response(null, { status: 401 });
    fetchMock.mockResolvedValue(response);

    const result = await authFetch('http://x/api', { headers: { Authorization: 'Bearer t' } });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('t');
    expect(result).toBe(response);
  });

  it('reconoce Authorization sin importar mayúsculas', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await authFetch('http://x/api', { headers: { authorization: 'Bearer t' } });

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lee Authorization de una instancia Headers y de pares, y quita el prefijo Bearer sin importar mayúsculas', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await authFetch('http://x/api', { headers: new Headers({ Authorization: 'Bearer uno' }) });
    await authFetch('http://x/api', { headers: [['authorization', 'bearer dos']] });

    expect(handler).toHaveBeenNthCalledWith(1, 'uno');
    expect(handler).toHaveBeenNthCalledWith(2, 'dos');
  });

  it('no avisa ante un 401 sin Authorization (login)', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    await authFetch('http://x/api', { headers: { 'Content-Type': 'application/json' } });
    await authFetch('http://x/api');

    expect(handler).not.toHaveBeenCalled();
  });

  it('no avisa ante una respuesta 200 con Authorization', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    await authFetch('http://x/api', { headers: { Authorization: 'Bearer t' } });

    expect(handler).not.toHaveBeenCalled();
  });

  it('no falla si no hay handler registrado', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }));

    const result = await authFetch('http://x/api', { headers: { Authorization: 'Bearer t' } });

    expect(result.status).toBe(401);
  });

  it('delega en fetch con los mismos argumentos', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
    const init = { method: 'POST' };

    await authFetch('http://x/api', init);

    expect(fetchMock).toHaveBeenCalledWith('http://x/api', init);
  });
});
