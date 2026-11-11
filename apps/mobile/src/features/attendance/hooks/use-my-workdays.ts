import type { MyWorkdaysDto } from '@rrhh/contracts';
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

import { attendanceErrorMessage } from '../attendance-error-message';

export type MyWorkdaysState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: MyWorkdaysDto };

interface Settled {
  month: string;
  attempt: number;
  outcome: Exclude<MyWorkdaysState, { status: 'loading' }>;
}

/** Jornadas guardadas de un mes (`YYYY-MM`); con `null` espera sin consultar. */
export function useMyWorkdays(month: string | null): {
  state: MyWorkdaysState;
  reload: () => void;
} {
  const [settled, setSettled] = useState<Settled | null>(null);
  // Cada `reload` sube el contador y relanza el efecto.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (month === null) return;
    // `cancelled` cubre el desmontaje y la respuesta tardía de un mes que ya no es el elegido.
    let cancelled = false;
    api.myAttendance
      .listMyWorkdays({ query: { month } })
      .then((data) => {
        if (!cancelled) setSettled({ month, attempt, outcome: { status: 'success', data } });
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          const outcome = { status: 'error' as const, message: attendanceErrorMessage(error) };
          setSettled({ month, attempt, outcome });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [month, attempt]);

  const reload = useCallback(() => {
    setAttempt((n) => n + 1);
  }, []);

  // Lo guardado solo vale para el mes e intento actuales; si no, la pantalla está cargando.
  const state: MyWorkdaysState =
    settled !== null && settled.month === month && settled.attempt === attempt
      ? settled.outcome
      : { status: 'loading' };

  return { state, reload };
}
