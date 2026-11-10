import type { MyTodayDto } from '@rrhh/contracts';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { attendanceErrorMessage } from '../attendance-error-message';

export type MyTodayState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: MyTodayDto };

/** Turno y marcaciones de hoy del colaborador autenticado. */
export function useMyToday(): { state: MyTodayState; reload: () => void } {
  const [state, setState] = useState<MyTodayState>({ status: 'loading' });
  // Cada `reload` sube el contador y relanza el efecto.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // `cancelled` cubre el desmontaje y una respuesta vieja que llega después de una más reciente.
    let cancelled = false;
    api.myAttendance
      .getMyAttendanceToday()
      .then((data) => {
        if (!cancelled) setState({ status: 'success', data });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', message: attendanceErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  }, []);

  return { state, reload };
}
