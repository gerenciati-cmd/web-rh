import { ApiError } from '@rrhh/api-client';
import type { MyWorkdaysDto } from '@rrhh/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useMyWorkdays } from './use-my-workdays';

vi.mock('@/lib/api', () => ({
  api: { myAttendance: { getMyAttendanceToday: vi.fn(), listMyWorkdays: vi.fn() } },
}));

const listWorkdays = vi.mocked(api.myAttendance.listMyWorkdays);

const november: MyWorkdaysDto = { month: '2026-11', items: [] };
const october: MyWorkdaysDto = { month: '2026-10', items: [] };

afterEach(cleanup);
beforeEach(() => {
  listWorkdays.mockReset();
});

describe('useMyWorkdays', () => {
  it('con month null se queda en loading y no consulta', () => {
    const { result } = renderHook(() => useMyWorkdays(null));

    expect(result.current.state).toEqual({ status: 'loading' });
    expect(listWorkdays).not.toHaveBeenCalled();
  });

  it('cuando month deja de ser null consulta ese mes', async () => {
    listWorkdays.mockResolvedValue(november);
    const { result, rerender } = renderHook(({ month }) => useMyWorkdays(month), {
      initialProps: { month: null as string | null },
    });

    rerender({ month: '2026-11' });
    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'success', data: november });
    });
    expect(listWorkdays).toHaveBeenCalledWith({ query: { month: '2026-11' } });
  });

  it('pasa de loading a success con los datos', async () => {
    listWorkdays.mockResolvedValue(november);
    const { result } = renderHook(() => useMyWorkdays('2026-11'));
    expect(result.current.state).toEqual({ status: 'loading' });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'success', data: november });
    });
  });

  it('MONTH_NOT_AVAILABLE pasa a error con su mensaje', async () => {
    listWorkdays.mockRejectedValue(new ApiError(422, 'MONTH_NOT_AVAILABLE', 'x'));
    const { result } = renderHook(() => useMyWorkdays('2025-01'));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'Solo puedes consultar el mes actual y el anterior.',
      });
    });
  });

  it('un fallo de red pasa a error con el mensaje de conexión', async () => {
    listWorkdays.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = renderHook(() => useMyWorkdays('2026-11'));

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.',
      });
    });
  });

  it('cambiar de mes refetch-ea y muestra loading mientras llega el nuevo', async () => {
    listWorkdays.mockResolvedValueOnce(november);
    const { result, rerender } = renderHook(({ month }) => useMyWorkdays(month), {
      initialProps: { month: '2026-11' },
    });
    await waitFor(() => {
      expect(result.current.state.status).toBe('success');
    });

    const pending = Promise.withResolvers<MyWorkdaysDto>();
    listWorkdays.mockReturnValueOnce(pending.promise);
    rerender({ month: '2026-10' });

    expect(result.current.state).toEqual({ status: 'loading' });
    expect(listWorkdays).toHaveBeenLastCalledWith({ query: { month: '2026-10' } });

    await act(async () => {
      pending.resolve(october);
      await pending.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', data: october });
  });

  it('la respuesta tardía del mes anterior elegido no pisa el mes vigente', async () => {
    const novemberCall = Promise.withResolvers<MyWorkdaysDto>();
    const octoberCall = Promise.withResolvers<MyWorkdaysDto>();
    listWorkdays.mockReturnValueOnce(novemberCall.promise).mockReturnValueOnce(octoberCall.promise);
    const { result, rerender } = renderHook(({ month }) => useMyWorkdays(month), {
      initialProps: { month: '2026-11' },
    });

    rerender({ month: '2026-10' });
    await act(async () => {
      octoberCall.resolve(october);
      await octoberCall.promise;
    });
    await act(async () => {
      novemberCall.resolve(november);
      await novemberCall.promise;
    });

    expect(result.current.state).toEqual({ status: 'success', data: october });
  });

  it('un error tardío de un mes ya descartado no se muestra', async () => {
    const novemberCall = Promise.withResolvers<MyWorkdaysDto>();
    listWorkdays.mockReturnValueOnce(novemberCall.promise).mockResolvedValueOnce(october);
    const { result, rerender } = renderHook(({ month }) => useMyWorkdays(month), {
      initialProps: { month: '2026-11' },
    });

    rerender({ month: '2026-10' });
    await waitFor(() => {
      expect(result.current.state.status).toBe('success');
    });
    await act(async () => {
      novemberCall.reject(new TypeError('tarde'));
      await novemberCall.promise.catch(() => undefined);
    });

    expect(result.current.state).toEqual({ status: 'success', data: october });
  });

  it('reload consulta de nuevo el mismo mes y se recupera de un error', async () => {
    listWorkdays.mockRejectedValueOnce(new TypeError('caído'));
    const { result } = renderHook(() => useMyWorkdays('2026-11'));
    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    const pending = Promise.withResolvers<MyWorkdaysDto>();
    listWorkdays.mockReturnValueOnce(pending.promise);
    act(() => {
      result.current.reload();
    });
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(listWorkdays).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.resolve(november);
      await pending.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', data: november });
  });

  it('tras desmontar, una respuesta tardía no actualiza el estado ni lanza', async () => {
    const pending = Promise.withResolvers<MyWorkdaysDto>();
    listWorkdays.mockReturnValue(pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useMyWorkdays('2026-11'));

    unmount();
    await act(async () => {
      pending.resolve(november);
      await pending.promise;
    });

    expect(result.current.state).toEqual({ status: 'loading' });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
