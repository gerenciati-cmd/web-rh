import { isSiteTimeZone } from '@rrhh/domain';
import { z } from 'zod';

import { CountrySchema, CreatedSchema, PageQuerySchema, pageOf } from '../common';
import { defineRoute, requires } from '../http';

// ── Modelos de lectura (lo que devuelve la API) ────────────────────────────
export const SiteSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    country: CountrySchema,
    timeZone: z.string().describe('Zona horaria IANA de la sede, p. ej. America/Cancun'),
    active: z.boolean().describe('false si la sede está dada de baja'),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Site' });
export type SiteDto = z.infer<typeof SiteSchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const CreateSiteSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(100)
      .describe('Nombre único de la sede, de 2 a 100 caracteres'),
    country: CountrySchema.describe('País donde está la sede'),
    timeZone: z
      .string()
      .trim()
      .describe('Zona horaria IANA; debe pertenecer a la lista permitida para el país'),
  })
  // La MISMA regla del dominio: la zona debe pertenecer a la lista cerrada del país.
  .refine((input) => isSiteTimeZone(input.country, input.timeZone), {
    path: ['timeZone'],
    message: 'Zona horaria no permitida para el país de la sede',
  })
  .meta({ id: 'CreateSiteInput' });
export type CreateSiteInput = z.input<typeof CreateSiteSchema>;

// ── Rutas ──────────────────────────────────────────────────────────────────
export const siteRoutes = {
  listSites: defineRoute({
    method: 'GET',
    path: '/sites',
    summary: 'Sedes del holding',
    description: [
      'Devuelve las sedes del holding (oficinas, plantas), paginadas.',
      '',
      '**Quién puede:** administrador del holding y RH. Las sedes son del holding, no de una empresa.',
      '',
      '**Necesita:** opcionalmente `page` y `pageSize`. No modifica datos.',
    ].join('\n'),
    access: requires('organization.sites:read'),
    query: PageQuerySchema,
    response: pageOf(SiteSchema),
  }),
  createSite: defineRoute({
    method: 'POST',
    path: '/sites',
    summary: 'Crea una sede del holding',
    description: [
      'Da de alta una sede. Queda activa y se puede asignar a colaboradores y checadores.',
      '',
      '**Quién puede:** solo el administrador del holding.',
      '',
      '**Necesita:** nombre único, país y una zona horaria válida para ese país. Responde con el `id` de la sede.',
    ].join('\n'),
    errors: ['SITE_ALREADY_EXISTS'],
    access: requires('organization.sites:manage'),
    body: CreateSiteSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
};
