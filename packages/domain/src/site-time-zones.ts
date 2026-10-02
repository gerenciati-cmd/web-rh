import type { CountryCode } from './country';

/**
 * Zonas horarias permitidas para una sede, por país. La lista es CERRADA a propósito
 * (decisión 8 de la serie organization-sedes): una zona válida pero equivocada para el lugar
 * desplaza todas las marcaciones. Agregar una zona es un cambio deliberado, no un dato libre.
 */
export const SITE_TIME_ZONES: Readonly<Record<CountryCode, readonly string[]>> = {
  MX: [
    'America/Mexico_City',
    'America/Cancun',
    'America/Merida',
    'America/Monterrey',
    'America/Matamoros',
    'America/Chihuahua',
    'America/Ciudad_Juarez',
    'America/Ojinaga',
    'America/Mazatlan',
    'America/Bahia_Banderas',
    'America/Hermosillo',
    'America/Tijuana',
  ],
  DO: ['America/Santo_Domingo'],
  CO: ['America/Bogota'],
};

export function isSiteTimeZone(country: CountryCode, timeZone: string): boolean {
  return SITE_TIME_ZONES[country].includes(timeZone);
}
