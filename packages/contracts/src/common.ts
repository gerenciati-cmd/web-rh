import { SUPPORTED_COUNTRIES } from '@rrhh/domain';
import { z } from 'zod';

/** Forma única de error en toda la API. `code` es estable (sirve para i18n en clientes). */
// `.meta({ id })` nombra el modelo en el documento OpenAPI (`components.schemas`); no cambia la
// validación. Solo se nombran modelos de cuerpo; params/query se expanden como parámetros.
export const ApiErrorSchema = z
  .object({
    code: z.string().describe('Código estable y legible por máquinas, p. ej. SITE_NOT_FOUND'),
    message: z
      .string()
      .describe('Mensaje en español para mostrar; puede cambiar, no lo uses para decidir'),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Opcional. Datos del caso (ids, campos inválidos); su forma depende del código'),
  })
  .meta({ id: 'ApiError' });
export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

export const PageQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(1)
    .describe('Opcional. Número de página, desde 1; por defecto 1'),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Opcional. Elementos por página, de 1 a 100; por defecto 20'),
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

export const CreatedSchema = z
  .object({ id: z.uuid().describe('Id del recurso creado') })
  .meta({ id: 'Created' });
export type Created = z.infer<typeof CreatedSchema>;

export const CountrySchema = z.enum(SUPPORTED_COUNTRIES);
