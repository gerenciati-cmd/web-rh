import type { CompanyDto } from '@rrhh/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CompanyTable } from './company-table';

afterEach(cleanup);
const company: CompanyDto = {
  id: '00000000-0000-4000-8000-000000000001',
  legalName: 'Empresa de prueba',
  taxId: '76.086.428-5',
  country: 'CL',
  active: true,
  createdAt: '2026-01-01T00:00:00Z',
};
describe('CompanyTable', () => {
  it('muestra el estado vacío', () => {
    render(<CompanyTable companies={[]} />);
    expect(screen.getByText('Aún no hay empresas registradas.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
  it('presenta datos y estados activo e inactivo', () => {
    render(
      <CompanyTable
        companies={[
          company,
          {
            ...company,
            id: '00000000-0000-4000-8000-000000000002',
            legalName: 'Empresa cerrada',
            active: false,
          },
        ]}
      />,
    );
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3);
    const active = rows[1];
    const inactive = rows[2];
    if (!active || !inactive) throw new Error('Faltan filas');
    expect(within(active).getByText(company.legalName)).toBeTruthy();
    expect(within(active).getByText(company.taxId)).toBeTruthy();
    expect(within(active).getByText('CL')).toBeTruthy();
    expect(within(active).getByText('Activa')).toBeTruthy();
    expect(within(inactive).getByText('Inactiva')).toBeTruthy();
  });
});
