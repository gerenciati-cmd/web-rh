import { normalizeIdentifier, type CountryCode, type IdentifierValidator } from '../country';

/** Estrategia de validación del documento de identidad de una PERSONA, por país. */
export type NationalIdValidator = IdentifierValidator;

const CURP_FORMAT = /^[A-Z]{4}\d{6}[HM][A-Z]{2}[A-Z]{3}[A-Z0-9]\d$/;

// Entidades federativas de RENAPO; `NE` = nacido en el extranjero.
const CURP_STATES: ReadonlySet<string> = new Set([
  'AS',
  'BC',
  'BS',
  'CC',
  'CH',
  'CL',
  'CM',
  'CS',
  'DF',
  'DG',
  'GR',
  'GT',
  'HG',
  'JC',
  'MC',
  'MN',
  'MS',
  'NE',
  'NL',
  'NT',
  'OC',
  'PL',
  'QR',
  'QT',
  'SL',
  'SP',
  'SR',
  'TC',
  'TL',
  'TS',
  'VZ',
  'YN',
  'ZS',
]);

const CURP_ALPHABET = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ';

/**
 * México — CURP (18 caracteres). Algoritmo según python-stdnum `mx.curp`: formato, fecha de
 * nacimiento real, clave de entidad y dígito verificador.
 */
export const mexicanCurpValidator: NationalIdValidator = {
  country: 'MX',
  normalize: normalizeIdentifier,

  isValid(normalized) {
    if (!CURP_FORMAT.test(normalized)) return false;
    if (!CURP_STATES.has(normalized.slice(11, 13))) return false;
    if (!isValidCurpDate(normalized)) return false;
    return curpCheckDigit(normalized.slice(0, 17)) === normalized.slice(17);
  },

  format: (normalized) => normalized,
};

/** Fecha AAMMDD en las posiciones 5–10; el carácter 17 fija el siglo (dígito = 19xx, letra = 20xx). */
function isValidCurpDate(curp: string): boolean {
  const century = /\d/.test(curp.charAt(16)) ? 1900 : 2000;
  const year = century + Number(curp.slice(4, 6));
  const month = Number(curp.slice(6, 8));
  const day = Number(curp.slice(8, 10));
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function curpCheckDigit(first17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += CURP_ALPHABET.indexOf(first17.charAt(i)) * (18 - i);
  return String((10 - (sum % 10)) % 10);
}

/**
 * República Dominicana — cédula de 11 dígitos. Solo formato: python-stdnum `do.cedula` lista
 * ~1.500 cédulas reales que no cumplen Luhn, así que validarlo rechazaría personas reales.
 */
export const dominicanCedulaValidator: NationalIdValidator = {
  country: 'DO',
  normalize: normalizeIdentifier,
  isValid: (normalized) => /^\d{11}$/.test(normalized),
  format: (normalized) =>
    `${normalized.slice(0, 3)}-${normalized.slice(3, 10)}-${normalized.slice(10)}`,
};

/** Colombia — cédula de ciudadanía: no tiene dígito verificador; las antiguas son más cortas. */
export const colombianCedulaValidator: NationalIdValidator = {
  country: 'CO',
  normalize: normalizeIdentifier,
  isValid: (normalized) => /^\d{3,10}$/.test(normalized),
  format: (normalized) => normalized.replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
};

export const NATIONAL_ID_VALIDATORS: Readonly<Record<CountryCode, NationalIdValidator>> = {
  MX: mexicanCurpValidator,
  DO: dominicanCedulaValidator,
  CO: colombianCedulaValidator,
};
