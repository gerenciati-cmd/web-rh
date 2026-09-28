/**
 * Países donde opera el holding (ADR 0009). Agregar un país obliga a registrar sus validadores
 * de identificador de empresa (`TAX_ID_VALIDATORS`) y de persona (`NATIONAL_ID_VALIDATORS`):
 * ambos registros son `Record<CountryCode, …>` y el compilador exige las tres claves.
 */
export const SUPPORTED_COUNTRIES = ['MX', 'DO', 'CO'] as const;

export type CountryCode = (typeof SUPPORTED_COUNTRIES)[number];

/**
 * Estrategia de validación de un identificador por país.
 *
 * Principio Abierto/Cerrado (OCP): para soportar un país nuevo se AGREGA un validador al
 * registro; los value objects (`NationalId`, `TaxId`) no se modifican.
 */
export interface IdentifierValidator {
  readonly country: CountryCode;
  /** Deja el valor en su forma canónica (sin puntos ni guiones, mayúsculas). */
  normalize(raw: string): string;
  isValid(normalized: string): boolean;
  /** Representación para mostrar (p. ej. 900.123.456-8). */
  format(normalized: string): string;
}

/** Normalización común: quita `.`, `-` y espacios, y pasa a mayúsculas (conserva `Ñ` y `&`). */
export function normalizeIdentifier(raw: string): string {
  return raw.replace(/[.\-\s]/g, '').toUpperCase();
}
