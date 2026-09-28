import { ApiError } from '@rrhh/api-client';
import type { CompanyDto } from '@rrhh/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; companies: CompanyDto[] };

async function fetchCompanies(): Promise<State> {
  try {
    const page = await api.organization.listCompanies({ query: { page: 1, pageSize: 50 } });
    return { status: 'success', companies: page.items };
  } catch (error) {
    return {
      status: 'error',
      message: ApiError.isApiError(error) ? error.code : 'No se pudo conectar con el API',
    };
  }
}

/**
 * Hook de datos: separa "cómo se obtienen" de "cómo se muestran".
 * Cuando haya más pantallas, migrar a TanStack Query (caché, reintentos, offline).
 */
export function useCompanies() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const mounted = useRef(false);
  const generation = useRef(0);

  const load = useCallback(async () => {
    const request = ++generation.current;
    const next = await fetchCompanies();
    if (mounted.current && request === generation.current) setState(next);
  }, []);

  const invalidate = useCallback(() => {
    generation.current++;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      // Invalida las respuestas pendientes incluso durante el remount de StrictMode.
      invalidate();
    };
  }, [load, invalidate]);

  const reload = useCallback(async () => {
    if (!mounted.current) return;
    setState({ status: 'loading' });
    await load();
  }, [load]);

  return { state, reload };
}
