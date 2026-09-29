import { describe, expect, it } from 'vitest';

import { TaxId } from './tax-id';

describe('TaxId', () => {
  it('México: acepta y normaliza un RFC de persona moral (RFC público de prueba del SAT)', () => {
    const result = TaxId.create('MX', 'EKU9003173C9');
    expect(result.ok && result.value.value).toBe('EKU9003173C9');
    expect(result.ok && result.value.format()).toBe('EKU9003173C9');
  });

  it('México: acepta otro RFC válido con fecha distinta', () => {
    expect(TaxId.create('MX', 'AAA010101AAA').ok).toBe(true);
  });

  it('México: rechaza un RFC de longitud incorrecta', () => {
    expect(TaxId.create('MX', 'EKU900317').ok).toBe(false);
  });

  it('México: rechaza un RFC con un mes de constitución inexistente', () => {
    expect(TaxId.create('MX', 'EKU9013173C9').ok).toBe(false);
  });

  it('México: TaxId.isValid coincide con el resultado de create', () => {
    expect(TaxId.isValid('MX', 'EKU9003173C9')).toBe(true);
    expect(TaxId.isValid('MX', 'EKU900317')).toBe(false);
  });

  it('República Dominicana: acepta y formatea un RNC de 9 dígitos', () => {
    const result = TaxId.create('DO', '131246796');
    expect(result.ok && result.value.format()).toBe('1-31-24679-6');
  });

  it('República Dominicana: rechaza un RNC con menos de 9 dígitos', () => {
    expect(TaxId.create('DO', '13124679').ok).toBe(false);
  });

  it('República Dominicana: rechaza un RNC con más de 9 dígitos', () => {
    expect(TaxId.create('DO', '1312467960').ok).toBe(false);
  });

  it('Colombia: acepta un NIT con dígito verificador correcto y lo normaliza sin separadores', () => {
    const result = TaxId.create('CO', '900.123.456-8');
    expect(result.ok && result.value.value).toBe('9001234568');
    expect(result.ok && result.value.format()).toBe('900.123.456-8');
  });

  it('Colombia: acepta otro NIT válido (213.123.432-1)', () => {
    expect(TaxId.create('CO', '213.123.432-1').ok).toBe(true);
  });

  it('Colombia: rechaza un NIT con dígito verificador incorrecto', () => {
    expect(TaxId.create('CO', '900123456-9').ok).toBe(false);
  });

  it('Colombia: TaxId.isValid coincide con el resultado de create', () => {
    expect(TaxId.isValid('CO', '900.123.456-8')).toBe(true);
    expect(TaxId.isValid('CO', '900123456-9')).toBe(false);
  });
});
