import { ApiError } from '@rrhh/api-client';
import type { MyTodayDto } from '@rrhh/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { useMyToday } from './use-my-today';

vi.mock('@/lib/api', () => ({
  api: { myAttendance: { getMyAttendanceToday: vi.fn(), listMyWorkdays: vi.fn() } },
}));

const getToday = vi.mocked(api.myAttendance.getMyAttendanceToday);

const today: MyTodayDto = {
  date: '2026-11-10',
  timeZone: 'America/Cancun',
  shift: null,
  punches: ['2026-11-10T13:56:00.000Z'],
};
const later: MyTodayDto = { ...today, punches: [] };

afterEach(cleanup);
beforeEach(() => {
  getToday.mockReset();
});

describe('useMyToday', () => {
  it('empieza en loading y pasa a success con los datos', async () => {
    getToday.mockResolvedValue(today);
    const { result } = renderHook(() => useMyToday());
    expect(result.current.state).toEqual({ status: 'loading' });

    await waitFor(() => {
      expect(result.current.state).toEqual({ status: 'success', data: today });
    });
    expect(getToday).toHaveBeenCalledTimes(1);
  });

  it('un ApiError conocido pasa a error con su mensaje en español', async () => {
    getToday.mockRejectedValue(new ApiError(403, 'ACCOUNT_NOT_LINKED', 'x'));
    const { result } = renderHook(() => useMyToday());

    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });
    expect(result.current.state).toEqual({
      status: 'error',
      message:
        'Tu cuenta no está vinculada a un colaborador, así que no hay asistencia que mostrar.',
    });
  });

  it('un fallo de red pasa a error con el mensaje de conexión', async () => {
    getToday.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = renderHook(() => useMyToday());

    await waitFor(() => {
      expect(result.current.state).toEqual({
        status: 'error',
        message: 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.',
      });
    });
  });

  it('reload vuelve a loading y consulta de nuevo; el error se recupera', async () => {
    getToday.mockRejectedValueOnce(new TypeError('caído'));
    const { result } = renderHook(() => useMyToday());
    await waitFor(() => {
      expect(result.current.state.status).toBe('error');
    });

    const pending = Promise.withResolvers<MyTodayDto>();
    getToday.mockReturnValueOnce(pending.promise);
    act(() => {
      result.current.reload();
    });
    expect(result.current.state).toEqual({ status: 'loading' });
    expect(getToday).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending.resolve(today);
      await pending.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', data: today });
  });

  it('una respuesta vieja que llega después de un reload no pisa la nueva', async () => {
    const first = Promise.withResolvers<MyTodayDto>();
    const second = Promise.withResolvers<MyTodayDto>();
    getToday.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMyToday());

    act(() => {
      result.current.reload();
    });
    await act(async () => {
      second.resolve(later);
      await second.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', data: later });

    await act(async () => {
      first.resolve(today);
      await first.promise;
    });
    expect(result.current.state).toEqual({ status: 'success', data: later });
  });

  it('un error viejo tardío tampoco pisa un éxito más reciente', async () => {
    const first = Promise.withResolvers<MyTodayDto>();
    const second = Promise.withResolvers<MyTodayDto>();
    getToday.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useMyToday());

    act(() => {
      result.current.reload();
    });
    await act(async () => {
      second.resolve(today);
      await second.promise;
    });
    await act(async () => {
      first.reject(new TypeError('tarde'));
      await first.promise.catch(() => undefined);
    });
    expect(result.current.state).toEqual({ status: 'success', data: today });
  });

  it('tras desmontar, una respuesta tardía no actualiza el estado ni lanza', async () => {
    const pending = Promise.withResolvers<MyTodayDto>();
    getToday.mockReturnValue(pending.promise);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => useMyToday());

    unmount();
    await act(async () => {
      pending.resolve(today);
      await pending.promise;
    });

    expect(result.current.state).toEqual({ status: 'loading' });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
