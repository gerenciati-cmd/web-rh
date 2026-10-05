import { describe, expect, it } from 'vitest';

import { SUPPORTED_COUNTRIES } from './country';
import { isSiteTimeZone, SITE_TIME_ZONES } from './site-time-zones';
import { isValidTimeZone } from './time-zone';

describe('isSiteTimeZone', () => {
  it.each([
    ['MX', 'America/Cancun'],
    ['MX', 'America/Mexico_City'],
    ['MX', 'America/Tijuana'],
    ['DO', 'America/Santo_Domingo'],
    ['CO', 'America/Bogota'],
  ] as const)('acepta %s con %s', (country, timeZone) => {
    expect(isSiteTimeZone(country, timeZone)).toBe(true);
  });

  it.each([
    ['MX', 'America/Bogota'],
    ['DO', 'America/Cancun'],
    ['CO', 'America/Mexico_City'],
    ['MX', 'Mars/Olympus'],
    ['MX', 'america/cancun'],
    ['MX', ''],
  ] as const)('rechaza %s con %j', (country, timeZone) => {
    expect(isSiteTimeZone(country, timeZone)).toBe(false);
  });

  it('cada país soportado tiene lista y todas sus zonas existen en el runtime', () => {
    for (const country of SUPPORTED_COUNTRIES) {
      expect(SITE_TIME_ZONES[country].length).toBeGreaterThan(0);
      for (const zone of SITE_TIME_ZONES[country]) expect(isValidTimeZone(zone)).toBe(true);
    }
  });
});
