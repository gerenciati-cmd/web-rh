/**
 * Estrategias de validación de documento de identidad por país.
 *
 * Principio Abierto/Cerrado (OCP): para soportar un país nuevo se AGREGA un validador
 * a `NATIONAL_ID_VALIDATORS`; `NationalId` no se modifica.
 */
export interface NationalIdValidator {
  readonly country: CountryCode;
  /** Deja el valor en su forma canónica (sin puntos, mayúsculas, etc.). */
  normalize(raw: string): string;
  isValid(normalized: string): boolean;
  /** Representación para mostrar (p. ej. 12.345.678-5). */
  format(normalized: string): string;
}

export type CountryCode = 'CL' | 'PE';

/** Chile — RUT con dígito verificador módulo 11. */
export const chileanRutValidator: NationalIdValidator = {
  country: 'CL',

  normalize: (raw) => raw.replace(/[.\s-]/g, '').toUpperCase(),

  isValid(normalized) {
    if (!/^\d{7,8}[\dK]$/.test(normalized)) return false;
    const body = normalized.slice(0, -1);
    const verifier = normalized.slice(-1);
    return computeRutVerifier(body) === verifier;
  },

  format(normalized) {
    const body = normalized.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return `${body}-${normalized.slice(-1)}`;
  },
};

function computeRutVerifier(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const remainder = 11 - (sum % 11);
  if (remainder === 11) return '0';
  if (remainder === 10) return 'K';
  return String(remainder);
}

/** Perú — DNI de 8 dígitos. */
export const peruvianDniValidator: NationalIdValidator = {
  country: 'PE',
  normalize: (raw) => raw.replace(/\s/g, ''),
  isValid: (normalized) => /^\d{8}$/.test(normalized),
  format: (normalized) => normalized,
};

export const NATIONAL_ID_VALIDATORS: Readonly<Record<CountryCode, NationalIdValidator>> = {
  CL: chileanRutValidator,
  PE: peruvianDniValidator,
};

export const SUPPORTED_COUNTRIES = Object.keys(NATIONAL_ID_VALIDATORS) as CountryCode[];
