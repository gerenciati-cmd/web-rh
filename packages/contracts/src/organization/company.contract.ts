import { TaxId } from '@rrhh/domain';
import { z } from 'zod';

import { CountrySchema, CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const CompanySchema = z
  .object({
    id: z.uuid(),
    legalName: z.string().describe('Razón social'),
    taxId: z.string().describe('Identificador tributario (RFC en México)'),
    country: CountrySchema.describe('País de la razón social'),
    active: z.boolean().describe('false si la empresa está dada de baja'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Company' });
export type CompanyDto = z.infer<typeof CompanySchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const CreateCompanySchema = z
  .object({
    legalName: z.string().trim().min(2).max(200).describe('Razón social, de 2 a 200 caracteres'),
    taxId: z
      .string()
      .trim()
      .min(1)
      .describe('Identificador tributario; debe ser válido para el país indicado'),
    country: CountrySchema.describe('País de la razón social'),
  })
  // La MISMA regla del dominio: el formulario falla igual que fallaría el backend.
  .refine((input) => TaxId.isValid(input.country, input.taxId), {
    path: ['taxId'],
    message: 'Identificador tributario inválido',
  })
  .meta({ id: 'CreateCompanyInput' });
export type CreateCompanyInput = z.input<typeof CreateCompanySchema>;

const CompanyParams = z.object({ companyId: z.uuid().describe('Id de la empresa') });

// ── Rutas ──────────────────────────────────────────────────────────────────
export const organizationRoutes = {
  listCompanies: defineRoute({
    method: 'GET',
    path: '/companies',
    summary: 'Lista paginada de empresas del holding',
    description: [
      'Devuelve las empresas del holding, paginadas.',
      '',
      '**Quién puede:** administrador del holding (todas las empresas) y RH (solo las de su alcance).',
      '',
      '**Necesita:** opcionalmente `page` y `pageSize`. No modifica datos.',
    ].join('\n'),
    access: requires('organization.companies:read'),
    query: PageQuerySchema,
    response: pageOf(CompanySchema),
  }),
  getCompany: defineRoute({
    method: 'GET',
    path: '/companies/:companyId',
    summary: 'Detalle de una empresa',
    description: [
      'Devuelve los datos de una empresa.',
      '',
      '**Quién puede:** administrador del holding, o RH si la empresa está en su alcance.',
      '',
      '**Necesita:** el `companyId` en la ruta. No modifica datos.',
    ].join('\n'),
    errors: ['COMPANY_NOT_FOUND'],
    access: requires('organization.companies:read', { companyParam: 'companyId' }),
    params: CompanyParams,
    response: CompanySchema,
  }),
  createCompany: defineRoute({
    method: 'POST',
    path: '/companies',
    summary: 'Crea una empresa en el holding',
    description: [
      'Da de alta una empresa (razón social) en el holding. Queda activa.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** razón social, país e identificador tributario válido para ese país. Responde con el `id` de la empresa creada.',
    ].join('\n'),
    errors: ['COMPANY_ALREADY_EXISTS'],
    access: requires('organization.companies:create'),
    body: CreateCompanySchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
};
