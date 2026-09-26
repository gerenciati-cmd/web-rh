import { ApiError } from '@rrhh/api-client';
import type { CompanyDto } from '@rrhh/contracts';
import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    let cancelled = false;
    void fetchCompanies().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const reload = useCallback(async () => {
    setState({ status: 'loading' });
    setState(await fetchCompanies());
  }, []);

  return { state, reload };
}
