import { describe, expect, it } from 'vitest';

import type { CountryCode } from '../country';
import { InvalidValueError } from '../errors';

import { NationalId } from './national-id';

describe('NationalId', () => {
  it('México: acepta y normaliza una CURP válida', () => {
    const result = NationalId.create('MX', 'goma850101hqrrrn04');
    expect(result.ok && result.value.value).toBe('GOMA850101HQRRRN04');
  });

  it('México: format() muestra la CURP tal cual se almacena', () => {
    const result = NationalId.create('MX', 'goma850101hqrrrn04');
    expect(result.ok && result.value.format()).toBe('GOMA850101HQRRRN04');
  });

  it('México: acepta una CURP de mujer nacida en 1990 en DF', () => {
    expect(NationalId.create('MX', 'PEXL900215MDFRPR07').ok).toBe(true);
  });

  it('México: acepta una CURP nacida en 2001 (siglo 20xx por la letra en la posición 17)', () => {
    expect(NationalId.create('MX', 'ROSA010305HQRDNLA3').ok).toBe(true);
  });

  it('México: rechaza una CURP con dígito verificador incorrecto', () => {
    const result = NationalId.create('MX', 'GOMA850101HQRRRN05');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('INVALID_VALUE');
  });

  it('México: rechaza formato inválido (longitud incorrecta)', () => {
    expect(NationalId.create('MX', 'GOMA850101HQRRRN0').ok).toBe(false);
  });

  it('México: rechaza una fecha de nacimiento que no existe en el calendario', () => {
    // 850230: 30 de febrero no existe. Dígito verificador correcto (2), para aislar solo la
    // regla de fecha (si no, un DV incorrecto rechazaría igual aunque se quitara esta regla).
    expect(NationalId.create('MX', 'GOMA850230HQRRRN02').ok).toBe(false);
  });

  it('México: rechaza una clave de entidad federativa inexistente', () => {
    // XX no es una entidad federativa válida. Fecha real y dígito verificador correcto (9),
    // para aislar solo la regla de entidad federativa.
    expect(NationalId.create('MX', 'GOMA850101HXXRRN09').ok).toBe(false);
  });

  it('México: NationalId.isValid coincide con el resultado de create', () => {
    expect(NationalId.isValid('MX', 'GOMA850101HQRRRN04')).toBe(true);
    expect(NationalId.isValid('MX', 'GOMA850101HQRRRN05')).toBe(false);
  });

  it('República Dominicana: acepta y formatea una cédula de 11 dígitos', () => {
    const result = NationalId.create('DO', '00113918205');
    expect(result.ok && result.value.format()).toBe('001-1391820-5');
  });

  it('República Dominicana: rechaza una cédula con menos de 11 dígitos', () => {
    expect(NationalId.create('DO', '0011391820').ok).toBe(false);
  });

  it('República Dominicana: rechaza una cédula con más de 11 dígitos', () => {
    expect(NationalId.create('DO', '001139182050').ok).toBe(false);
  });

  it('Colombia: acepta y formatea una cédula de ciudadanía', () => {
    const result = NationalId.create('CO', '1020304050');
    expect(result.ok && result.value.format()).toBe('1.020.304.050');
  });

  it('Colombia: acepta una cédula corta (formato antiguo, 3 dígitos)', () => {
    expect(NationalId.create('CO', '123').ok).toBe(true);
  });

  it('Colombia: rechaza una cédula con más de 10 dígitos', () => {
    expect(NationalId.create('CO', '12345678901').ok).toBe(false);
  });

  it('Colombia: rechaza caracteres no numéricos', () => {
    expect(NationalId.create('CO', '10203ABCDE').ok).toBe(false);
  });

  // Regresión: filas viejas con country = 'CL' llegan por cast; antes lanzaban TypeError.
  it('rechaza con InvalidValueError un país fuera de SUPPORTED_COUNTRIES en vez de lanzar', () => {
    const country = 'CL' as CountryCode;
    const result = NationalId.create(country, '123456785');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(InvalidValueError);
    expect(NationalId.isValid(country, '123456785')).toBe(false);
  });
});
