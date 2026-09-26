import { ApiError } from '@rrhh/api-client';
import type { Metadata } from 'next';
import { connection } from 'next/server';

import { CompanyTable } from '@/features/organization/components/company-table';
import { api } from '@/lib/api';

export const metadata: Metadata = { title: 'Empresas' };

/** La ruta es delgada: busca datos vía api-client y delega la UI al feature. */
export default async function CompaniesPage() {
  // Datos vivos: renderizar en cada request, nunca pre-renderizar en el build.
  await connection();

  const result = await api.organization
    .listCompanies({ query: { page: 1, pageSize: 50 } })
    .then((page) => ({ ok: true as const, page }))
    .catch((error: unknown) => ({ ok: false as const, error }));

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10">
      <h1 className="mb-6 text-2xl font-semibold">Empresas del holding</h1>
      {result.ok ? (
        <CompanyTable companies={result.page.items} />
      ) : (
        <p className="text-sm text-red-600">
          No se pudo cargar el listado
          {ApiError.isApiError(result.error) ? ` (${result.error.code})` : ' (API no disponible)'}.
        </p>
      )}
    </main>
  );
}
