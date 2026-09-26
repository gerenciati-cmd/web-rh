import type { CompanyDto } from '@rrhh/contracts';

/** Componente de presentación puro: recibe datos, no los busca (fácil de testear y reusar). */
export function CompanyTable({ companies }: { companies: CompanyDto[] }) {
  if (companies.length === 0) {
    return <p className="text-sm opacity-70">Aún no hay empresas registradas.</p>;
  }

  return (
    <table className="w-full text-left text-sm">
      <thead className="border-b border-current/15">
        <tr>
          <th className="py-2 font-medium">Razón social</th>
          <th className="py-2 font-medium">Identificador tributario</th>
          <th className="py-2 font-medium">País</th>
          <th className="py-2 font-medium">Estado</th>
        </tr>
      </thead>
      <tbody>
        {companies.map((company) => (
          <tr key={company.id} className="border-b border-current/10">
            <td className="py-2">{company.legalName}</td>
            <td className="py-2 font-mono">{company.taxId}</td>
            <td className="py-2">{company.country}</td>
            <td className="py-2">{company.active ? 'Activa' : 'Inactiva'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
