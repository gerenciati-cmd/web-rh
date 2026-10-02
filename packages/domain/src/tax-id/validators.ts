import { normalizeIdentifier, type CountryCode, type IdentifierValidator } from '../country';

/** Estrategia de validación del identificador tributario de una EMPRESA, por país. */
export type TaxIdValidator = IdentifierValidator;

const RFC_MORAL_FORMAT = /^[A-Z&Ñ]{3}\d{6}[A-Z0-9]{3}$/;

/**
 * México — RFC de persona moral (12 caracteres): formato y fecha de constitución real (AAMMDD).
 * Sin dígito verificador: python-stdnum `mx.rfc` documenta que ~1,5 % de los RFC reales lo
 * traen inválido y desactiva esa comprobación.
 */
export const mexicanRfcMoralValidator: TaxIdValidator = {
  country: 'MX',
  normalize: normalizeIdentifier,
  isValid: (normalized) =>
    RFC_MORAL_FORMAT.test(normalized) && isValidYymmdd(normalized.slice(3, 9)),
  format: (normalized) => normalized,
};

/** El RFC no indica el siglo: se acepta la fecha si existe en alguno de los dos. */
export function isValidYymmdd(yymmdd: string): boolean {
  const yy = Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  return [1900, 2000].some((century) => {
    const date = new Date(Date.UTC(century + yy, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  });
}

/**
 * República Dominicana — RNC de 9 dígitos. Solo formato: python-stdnum `do.rnc` lista RNC
 * reales que no cumplen su dígito verificador.
 */
export const dominicanRncValidator: TaxIdValidator = {
  country: 'DO',
  normalize: normalizeIdentifier,
  isValid: (normalized) => /^\d{9}$/.test(normalized),
  format: (normalized) =>
    `${normalized.slice(0, 1)}-${normalized.slice(1, 3)}-${normalized.slice(3, 8)}-${normalized.slice(8)}`,
};

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** Colombia — NIT con dígito verificador (último dígito). Algoritmo según python-stdnum `co.nit`. */
export const colombianNitValidator: TaxIdValidator = {
  country: 'CO',
  normalize: normalizeIdentifier,
  isValid: (normalized) =>
    /^\d{8,16}$/.test(normalized) &&
    nitCheckDigit(normalized.slice(0, -1)) === normalized.slice(-1),
  format: (normalized) =>
    `${normalized.slice(0, -1).replace(/\B(?=(\d{3})+(?!\d))/g, '.')}-${normalized.slice(-1)}`,
};

/** Pesos aplicados a los dígitos del cuerpo leídos de derecha a izquierda, módulo 11. */
function nitCheckDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body.charAt(body.length - 1 - i)) * (NIT_WEIGHTS[i] ?? 0);
  }
  return '01987654321'.charAt(sum % 11);
}

export const TAX_ID_VALIDATORS: Readonly<Record<CountryCode, TaxIdValidator>> = {
  MX: mexicanRfcMoralValidator,
  DO: dominicanRncValidator,
  CO: colombianNitValidator,
};
