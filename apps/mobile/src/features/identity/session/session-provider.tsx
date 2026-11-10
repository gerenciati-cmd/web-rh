import { ApiError } from '@rrhh/api-client';
import type { SessionUser } from '@rrhh/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api';

import { setUnauthorizedHandler } from './auth-fetch';
import {
  deletePersistedSession,
  getCurrentToken,
  loadPersistedSession,
  persistSession,
  setCurrentSession,
  type StoredSession,
} from './session-store';

type SessionStatus = 'loading' | 'signedOut' | 'signedIn';

export interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  notice: 'expired' | null;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Dueño de la sesión de la app. Mientras restaura la sesión guardada está en `loading`; el layout
 * raíz no renderiza nada en ese lapso para que el splash nativo siga visible.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [notice, setNotice] = useState<'expired' | null>(null);

  const clear = useCallback((nextNotice: 'expired' | null) => {
    setCurrentSession(null);
    void deletePersistedSession().catch(() => {
      // Si el almacén falla, la sesión en memoria ya se limpió: el usuario queda fuera igualmente.
    });
    setStatus('signedOut');
    setUser(null);
    setNotice(nextNotice);
  }, []);

  useEffect(() => {
    // Objeto en vez de `let`: TypeScript no estrecha una propiedad mutada desde el cleanup.
    const lifecycle = { active: true };
    const isActive = () => lifecycle.active;
    setUnauthorizedHandler((rejectedToken) => {
      // Un 401 tardío de un token viejo no debe cerrar la sesión nueva.
      if (isActive() && rejectedToken === getCurrentToken()) clear('expired');
    });

    void (async () => {
      let stored: StoredSession | null = null;
      try {
        stored = await loadPersistedSession();
      } catch {
        stored = null;
      }
      if (!isActive()) return;
      if (!stored) {
        setStatus('signedOut');
        return;
      }

      setCurrentSession(stored);
      setUser(stored.user);
      setStatus('signedIn');

      // Se confirma en segundo plano: sin red la app sigue con el usuario guardado.
      try {
        const fresh = await api.identity.me();
        // Releer: el efecto pudo limpiarse mientras esperaba al API.
        // Solo si la sesión vigente sigue siendo la que se confirmó: tras un cierre o un nuevo
        // login, escribir de vuelta resucitaría un token revocado.
        if (!isActive() || getCurrentToken() !== stored.token) return;
        setUser(fresh);
        const refreshed = { ...stored, user: fresh };
        setCurrentSession(refreshed);
        await persistSession(refreshed);
        // Si se cerró la sesión durante el guardado, el borrado pudo adelantarse a la escritura.
        if (getCurrentToken() === null) await deletePersistedSession();
      } catch (error) {
        // El 401 ya lo atiende el handler; cualquier otro error se ignora.
        if (error instanceof ApiError) return;
      }
    })();

    return () => {
      lifecycle.active = false;
      setUnauthorizedHandler(null);
    };
  }, [clear]);

  const signIn = useCallback(async (email: string, password: string, remember: boolean) => {
    const result = await api.identity.logIn({
      body: { email: email.trim(), password, client: 'mobile' },
    });
    if (result.token === null) {
      throw new Error('El API no devolvió el token de sesión');
    }

    const session: StoredSession = {
      token: result.token,
      user: result.user,
      expiresAt: result.expiresAt,
    };
    setCurrentSession(session);
    try {
      if (remember) {
        await persistSession(session);
      } else {
        await deletePersistedSession();
      }
    } catch (error) {
      // Sin rollback el token quedaría en memoria con el usuario fuera, y el servidor con una
      // sesión huérfana: se revoca (mejor esfuerzo) y se limpia antes de avisar.
      try {
        await api.identity.logOut();
      } catch {
        // Mejor esfuerzo.
      }
      if (getCurrentToken() === session.token) setCurrentSession(null);
      throw error;
    }
    // Un 401 de la propia sesión durante el await la limpió: no se declara sesión iniciada sin token.
    if (getCurrentToken() !== session.token) {
      throw new Error('La sesión se cerró durante el inicio de sesión');
    }
    setUser(result.user);
    setStatus('signedIn');
    setNotice(null);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.identity.logOut();
    } catch {
      // El cierre local debe ocurrir siempre, aunque el API no responda.
    }
    clear(null);
  }, [clear]);

  const value = useMemo(
    () => ({ status, user, notice, signIn, signOut }),
    [status, user, notice, signIn, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession debe usarse dentro de un SessionProvider');
  }
  return context;
}
