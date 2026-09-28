import { ApiError } from '@rrhh/api-client';
import type { CompanyDto, Page } from '@rrhh/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useCompanies } from './use-companies';

vi.mock('@/lib/api', () => ({ api: { organization: { listCompanies: vi.fn() } } }));
const list = vi.mocked(api.organization.listCompanies);
const empty: Page<CompanyDto> = { items: [], page: 1, pageSize: 50, total: 0 };
const company: CompanyDto = {
  id: '00000000-0000-4000-8000-000000000001',
  legalName: 'Empresa de prueba',
  country: 'CL',
  taxId: '76.086.428-5',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};
function deferred() {
  return Promise.withResolvers<Page<CompanyDto>>();
}
afterEach(cleanup);
beforeEach(() => {
  list.mockReset();
});
describe('useCompanies', () => {
  it('carga inicialmente y acepta un listado vacío', async () => {
    const pending = deferred();
    list.mockReturnValue(pending.promise);
    const { result } = renderHook(useCompanies);
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(list).toHaveBeenCalledWith({ query: { page: 1, pageSize: 50 } });
    await act(async () => {
      pending.resolve(empty);
      await pending.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', companies: [] });
  });
  it.each([
    [new ApiError(503, 'UNAVAILABLE', 'Servicio no disponible'), 'UNAVAILABLE'],
    [new Error('offline'), 'No se pudo conectar con el API'],
  ])('conserva mensaje de error y permite reintentar', async (error, message) => {
    list
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ ...empty, items: [company], total: 1 });
    const { result } = renderHook(useCompanies);
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'error', message });
    });
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.state).toEqual({ status: 'success', companies: [company] });
  });
  it('la carga inicial y recargas antiguas no sobrescriben la última petición', async () => {
    const initial = deferred();
    const older = deferred();
    const latest = deferred();
    list
      .mockReturnValueOnce(initial.promise)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const { result } = renderHook(useCompanies);
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = result.current.reload();
      second = result.current.reload();
    });
    expect(result.current.state.status).toBe('loading');
    await act(async () => {
      latest.resolve({ ...empty, total: 1, items: [company] });
      await second;
    });
    await act(async () => {
      older.resolve(empty);
      initial.resolve(empty);
      await first;
    });
    expect(result.current.state).toEqual({ status: 'success', companies: [company] });
  });
  it('invalida peticiones al desmontar y no lanza nuevas recargas', async () => {
    const pending = deferred();
    list.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(useCompanies);
    const reload = result.current.reload;
    unmount();
    await act(async () => {
      pending.resolve(empty);
      await pending.promise;
      await reload();
    });
    expect(list).toHaveBeenCalledTimes(1);
    expect(result.current.state).toEqual({ status: 'loading' });
  });
});
