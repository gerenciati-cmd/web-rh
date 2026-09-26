import { SUPPORTED_COUNTRIES, type CountryCode } from '@rrhh/domain';
import { z } from 'zod';

/** Forma única de error en toda la API. `code` es estable (sirve para i18n en clientes). */
export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export const PageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PageQuery = z.output<typeof PageQuerySchema>;

/** Genérico reutilizable: cualquier listado paginado tiene la misma forma. */
export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  });
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const CreatedSchema = z.object({ id: z.uuid() });
export type Created = z.infer<typeof CreatedSchema>;

export const CountrySchema = z.enum(SUPPORTED_COUNTRIES as [CountryCode, ...CountryCode[]]);
