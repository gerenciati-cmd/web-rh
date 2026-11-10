import { ApiError } from '@rrhh/api-client';
import type { SessionUser } from '@rrhh/contracts';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api } from '@/lib/api';

import { setUnauthorizedHandler } from './auth-fetch';
import { SessionProvider, useSession } from './session-provider';
import {
  deletePersistedSession,
  getCurrentToken,
  loadPersistedSession,
  persistSession,
  setCurrentSession,
  type StoredSession,
} from './session-store';

vi.mock('@/lib/api', () => ({
  api: { identity: { me: vi.fn(), logIn: vi.fn(), logOut: vi.fn() } },
}));
vi.mock('./session-store', () => ({
  getCurrentToken: vi.fn(),
  setCurrentSession: vi.fn(),
  persistSession: vi.fn(),
  loadPersistedSession: vi.fn(),
  deletePersistedSession: vi.fn(),
}));
vi.mock('./auth-fetch', () => ({ setUnauthorizedHandler: vi.fn() }));

const me = vi.mocked(api.identity.me);
const logIn = vi.mocked(api.identity.logIn);
const logOut = vi.mocked(api.identity.logOut);
const load = vi.mocked(loadPersistedSession);
const persist = vi.mocked(persistSession);
const remove = vi.mocked(deletePersistedSession);
const setSession = vi.mocked(setCurrentSession);
const setHandler = vi.mocked(setUnauthorizedHandler);
const currentToken = vi.mocked(getCurrentToken);

const user: SessionUser = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'persona@example.com',
  employeeId: null,
};
const freshUser: SessionUser = { ...user, email: 'nuevo@example.com' };
const stored: StoredSession = { token: 'tok', user, expiresAt: '2099-01-01T00:00:00Z' };

function wrapper({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [me, logIn, logOut, load, persist, remove, setSession, setHandler]) {
    fn.mockReset();
  }
  // El store real guarda el token en una variable de módulo: se imita para que las
  // comprobaciones de "sigue siendo la sesión vigente" vean los cambios.
  let token: string | null = null;
  currentToken.mockReset();
  currentToken.mockImplementation(() => token);
  setSession.mockImplementation((session) => {
    token = session?.token ?? null;
  });
  persist.mockResolvedValue(undefined);
  remove.mockResolvedValue(undefined);
  logOut.mockResolvedValue(undefined);
  me.mockResolvedValue(freshUser);
});

function lastHandler(): (rejectedToken: string) => void {
  const handler = setHandler.mock.calls.map(([h]) => h).findLast((h) => h !== null);
  if (!handler) throw new Error('no se registró el handler');
  return handler;
}

describe('useSession', () => {
  it('lanza un error en español fuera del provider', () => {
    expect(() => renderHook(() => useSession())).toThrow(
      'useSession debe usarse dentro de un SessionProvider',
    );
  });
});

describe('restauración', () => {
  it('empieza en loading y pasa a signedOut si no hay sesión guardada', async () => {
    load.mockResolvedValue(null);
    const { result } = renderHook(() => useSession(), { wrapper });
    expect(result.current.status).toBe('loading');
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    expect(result.current.user).toBeNull();
    expect(me).not.toHaveBeenCalled();
  });

  it('con sesión guardada queda signedIn, fija el token y luego actualiza el usuario con me', async () => {
    load.mockResolvedValue(stored);
    const pending = Promise.withResolvers<SessionUser>();
    me.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    expect(result.current.user).toEqual(user);
    expect(setSession).toHaveBeenCalledWith(stored);

    await act(async () => {
      pending.resolve(freshUser);
      await pending.promise;
    });
    await waitFor(() => {
      expect(result.current.user).toEqual(freshUser);
    });
    expect(persist).toHaveBeenCalledWith({ ...stored, user: freshUser });
  });

  it('si me falla sin ser ApiError (sin red) conserva el usuario guardado', async () => {
    load.mockResolvedValue(stored);
    me.mockRejectedValue(new TypeError('Network request failed'));
    const { result } = renderHook(() => useSession(), { wrapper });

    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    await waitFor(() => {
      expect(me).toHaveBeenCalled();
    });
    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual(user);
  });

  it('si loadPersistedSession lanza, queda signedOut', async () => {
    load.mockRejectedValue(new Error('almacén roto'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
  });

  it('registra el handler de no autorizado y lo retira al desmontar', () => {
    load.mockResolvedValue(null);
    const { unmount } = renderHook(() => useSession(), { wrapper });
    expect(setHandler).toHaveBeenCalledWith(expect.any(Function));
    unmount();
    expect(setHandler).toHaveBeenLastCalledWith(null);
  });
});

describe('signIn', () => {
  const loginResult = {
    user,
    expiresAt: '2099-01-01T00:00:00Z',
    token: 'nuevo-token',
  };

  async function mounted() {
    load.mockResolvedValue(null);
    const hook = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('signedOut');
    });
    return hook;
  }

  it('con recordarme persiste la sesión, recorta el correo y pide client mobile', async () => {
    logIn.mockResolvedValue(loginResult);
    const { result } = await mounted();

    await act(() => result.current.signIn('  persona@example.com ', 'secreta', true));

    expect(logIn).toHaveBeenCalledWith({
      body: { email: 'persona@example.com', password: 'secreta', client: 'mobile' },
    });
    const session: StoredSession = {
      token: 'nuevo-token',
      user,
      expiresAt: loginResult.expiresAt,
    };
    expect(setSession).toHaveBeenCalledWith(session);
    expect(persist).toHaveBeenCalledWith(session);
    expect(remove).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedIn');
    expect(result.current.user).toEqual(user);
    expect(result.current.notice).toBeNull();
  });

  it('sin recordarme borra lo persistido y no persiste', async () => {
    logIn.mockResolvedValue(loginResult);
    const { result } = await mounted();

    await act(() => result.current.signIn('persona@example.com', 'secreta', false));

    expect(persist).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(result.current.status).toBe('signedIn');
  });

  it('con token null lanza el error y no inicia sesión', async () => {
    logIn.mockResolvedValue({ ...loginResult, token: null });
    const { result } = await mounted();

    await expect(
      act(() => result.current.signIn('persona@example.com', 'secreta', true)),
    ).rejects.toThrow('El API no devolvió el token de sesión');
    expect(result.current.status).toBe('signedOut');
    expect(persist).not.toHaveBeenCalled();
  });

  it('propaga el ApiError del login y sigue signedOut', async () => {
    const error = new ApiError(401, 'INVALID_CREDENTIALS', 'x');
    logIn.mockRejectedValue(error);
    const { result } = await mounted();

    await expect(
      act(() => result.current.signIn('persona@example.com', 'mala', false)),
    ).rejects.toBe(error);
    expect(result.current.status).toBe('signedOut');
  });

  it('limpia el aviso de sesión vencida al iniciar sesión', async () => {
    logIn.mockResolvedValue(loginResult);
    const { result } = await mounted();
    // Se necesita una sesión vigente para que el 401 cuente.
    setSession({ token: 'viejo', user, expiresAt: loginResult.expiresAt });
    act(() => {
      lastHandler()('viejo');
    });
    expect(result.current.notice).toBe('expired');

    await act(() => result.current.signIn('persona@example.com', 'secreta', false));

    expect(result.current.notice).toBeNull();
  });
});

describe('signOut', () => {
  async function signedIn() {
    load.mockResolvedValue(stored);
    const hook = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.status).toBe('signedIn');
    });
    return hook;
  }

  it('llama a logOut y limpia la sesión sin aviso', async () => {
    const { result } = await signedIn();
    setSession.mockClear();

    await act(() => result.current.signOut());

    expect(logOut).toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith(null);
    expect(remove).toHaveBeenCalled();
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBeNull();
  });

  it('limpia la sesión local aunque logOut rechace', async () => {
    logOut.mockRejectedValue(new TypeError('sin red'));
    const { result } = await signedIn();

    await act(() => result.current.signOut());

    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });
});

describe('sesión vencida', () => {
  it('el handler de no autorizado cierra la sesión con notice expired', async () => {
    load.mockResolvedValue(stored);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    setSession.mockClear();
    remove.mockClear();

    act(() => {
      lastHandler()('tok');
    });

    expect(setSession).toHaveBeenCalledWith(null);
    expect(remove).toHaveBeenCalled();
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
    expect(result.current.notice).toBe('expired');
  });

  it('ignora un 401 de un token que ya no es el vigente', async () => {
    load.mockResolvedValue(stored);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    setSession.mockClear();

    act(() => {
      lastHandler()('token-viejo');
    });

    expect(setSession).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedIn');
    expect(result.current.notice).toBeNull();
  });

  it('un me lento no resucita la sesión si se cerró mientras tanto', async () => {
    load.mockResolvedValue(stored);
    const pending = Promise.withResolvers<SessionUser>();
    me.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    await act(() => result.current.signOut());
    setSession.mockClear();
    persist.mockClear();

    await act(async () => {
      pending.resolve(freshUser);
      await pending.promise;
    });

    expect(setSession).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('si el guardado del login falla revoca la sesión, limpia la memoria y propaga el error', async () => {
    load.mockResolvedValue(null);
    logIn.mockResolvedValue({
      user,
      expiresAt: '2099-01-01T00:00:00Z',
      token: 'nuevo-token',
    });
    const failure = new Error('keystore');
    persist.mockRejectedValue(failure);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });

    await expect(
      act(() => result.current.signIn('persona@example.com', 'secreta', true)),
    ).rejects.toBe(failure);

    expect(logOut).toHaveBeenCalled();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(result.current.status).toBe('signedOut');
  });

  it('si un 401 limpia la sesión durante el guardado, el login no queda signedIn sin token', async () => {
    load.mockResolvedValue(null);
    logIn.mockResolvedValue({
      user,
      expiresAt: '2099-01-01T00:00:00Z',
      token: 'nuevo-token',
    });
    const pendingPersist = Promise.withResolvers<undefined>();
    persist.mockReturnValue(pendingPersist.promise);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });

    let outcome: Promise<void> = Promise.resolve();
    await act(async () => {
      outcome = result.current.signIn('persona@example.com', 'secreta', true);
      outcome.catch(() => undefined);
      await waitFor(() => {
        expect(persist).toHaveBeenCalled();
      });
    });
    act(() => {
      lastHandler()('nuevo-token');
    });
    await act(async () => {
      pendingPersist.resolve(undefined);
      await pendingPersist.promise;
    });

    await expect(outcome).rejects.toThrow('La sesión se cerró durante el inicio de sesión');
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(result.current.status).toBe('signedOut');
    expect(result.current.user).toBeNull();
  });

  it('si el guardado falla y logOut también, propaga el error original y limpia la memoria', async () => {
    load.mockResolvedValue(null);
    logIn.mockResolvedValue({ user, expiresAt: '2099-01-01T00:00:00Z', token: 'nuevo-token' });
    const failure = new Error('keystore');
    persist.mockRejectedValue(failure);
    logOut.mockRejectedValue(new TypeError('sin red'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });

    await expect(
      act(() => result.current.signIn('persona@example.com', 'secreta', true)),
    ).rejects.toBe(failure);

    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(result.current.status).toBe('signedOut');
  });

  it('si borrar lo persistido falla (sin recordarme) también revoca y limpia', async () => {
    load.mockResolvedValue(null);
    logIn.mockResolvedValue({ user, expiresAt: '2099-01-01T00:00:00Z', token: 'nuevo-token' });
    const failure = new Error('keystore');
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedOut');
    });
    remove.mockRejectedValue(failure);

    await expect(
      act(() => result.current.signIn('persona@example.com', 'secreta', false)),
    ).rejects.toBe(failure);

    expect(logOut).toHaveBeenCalled();
    expect(setSession).toHaveBeenLastCalledWith(null);
    expect(result.current.status).toBe('signedOut');
  });
});

describe('me en segundo plano y carreras', () => {
  it('si se cierra la sesión durante el guardado del me, borra lo persistido', async () => {
    load.mockResolvedValue(stored);
    const pendingPersist = Promise.withResolvers<undefined>();
    persist.mockReturnValue(pendingPersist.promise);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(persist).toHaveBeenCalled();
    });

    await act(() => result.current.signOut());
    remove.mockClear();

    await act(async () => {
      pendingPersist.resolve(undefined);
      await pendingPersist.promise;
    });

    await waitFor(() => {
      expect(remove).toHaveBeenCalledTimes(1);
    });
    expect(result.current.status).toBe('signedOut');
  });

  it('con la sesión vigente, el guardado del me no borra lo persistido', async () => {
    load.mockResolvedValue(stored);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(persist).toHaveBeenCalledWith({ ...stored, user: freshUser });
    });

    expect(remove).not.toHaveBeenCalled();
    expect(result.current.status).toBe('signedIn');
  });

  it('un me lento no pisa una sesión nueva con otro token', async () => {
    load.mockResolvedValue(stored);
    const pending = Promise.withResolvers<SessionUser>();
    me.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(result.current.status).toBe('signedIn');
    });
    // Otro token pasa a ser el vigente mientras el me original sigue en vuelo.
    setSession({ token: 'otro', user, expiresAt: stored.expiresAt });
    setSession.mockClear();

    await act(async () => {
      pending.resolve(freshUser);
      await pending.promise;
    });

    expect(setSession).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(result.current.user).toEqual(user);
  });

  it('si me responde 401 (ApiError) no cambia el usuario ni persiste', async () => {
    load.mockResolvedValue(stored);
    me.mockRejectedValue(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'x'));
    const { result } = renderHook(() => useSession(), { wrapper });
    await waitFor(() => {
      expect(me).toHaveBeenCalled();
    });

    expect(persist).not.toHaveBeenCalled();
    expect(result.current.user).toEqual(user);
  });
});
