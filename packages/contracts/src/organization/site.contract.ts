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
    timeZone: z.string(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Site' });
export type SiteDto = z.infer<typeof SiteSchema>;

// ── Entradas (lo que envía el cliente) ─────────────────────────────────────
export const CreateSiteSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    country: CountrySchema,
    timeZone: z.string().trim(),
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
    access: requires('organization.sites:read'),
    query: PageQuerySchema,
    response: pageOf(SiteSchema),
  }),
  createSite: defineRoute({
    method: 'POST',
    path: '/sites',
    summary: 'Crea una sede del holding',
    access: requires('organization.sites:manage'),
    body: CreateSiteSchema,
    response: CreatedSchema,
    successStatus: 201,
  }),
};
