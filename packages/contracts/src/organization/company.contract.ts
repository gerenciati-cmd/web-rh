import { TaxId } from '@rrhh/domain';
import { z } from 'zod';

import { CountrySchema, CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const CompanySchema = z
  .object({
    id: z.uuid(),
    legalName: z.string(),
    taxId: z.string(),
    country: CountrySchema,
    active: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Company' });
export type CompanyDto = z.infer<typeof CompanySchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const CreateCompanySchema = z
  .object({
    legalName: z.string().trim().min(2).max(200),
    taxId: z.string().trim().min(1),
    country: CountrySchema,
  })
  // La MISMA regla del dominio: el formulario falla igual que fallaría el backend.
  .refine((input) => TaxId.isValid(input.country, input.taxId), {
    path: ['taxId'],
    message: 'Identificador tributario inválido',
  })
  .meta({ id: 'CreateCompanyInput' });
export type CreateCompanyInput = z.input<typeof CreateCompanySchema>;

const CompanyParams = z.object({ companyId: z.uuid() });

// ── Rutas ──────────────────────────────────────────────────────────────────
export const organizationRoutes = {
  listCompanies: defineRoute({
    method: 'GET',
    path: '/companies',
    summary: 'Lista paginada de empresas del holding',
    access: requires('organization.companies:read'),
    query: PageQuerySchema,
    response: pageOf(CompanySchema),
  }),
  getCompany: defineRoute({
    method: 'GET',
    path: '/companies/:companyId',
    summary: 'Detalle de una empresa',
    access: requires('organization.companies:read', { companyParam: 'companyId' }),
    params: CompanyParams,
    response: CompanySchema,
  }),
  createCompany: defineRoute({
    method: 'POST',
    path: '/companies',
    summary: 'Crea una empresa en el holding',
    access: requires('organization.companies:create'),
    body: CreateCompanySchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
};
