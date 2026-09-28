import { describe, expect, it } from 'vitest';

import { NationalId } from './national-id';

describe('NationalId', () => {
  it('México: acepta y normaliza una CURP válida', () => {
    const result = NationalId.create('MX', 'goma850101hqrrrn04');
    expect(result.ok && result.value.value).toBe('GOMA850101HQRRRN04');
  });

  it('México: rechaza una CURP con dígito verificador incorrecto', () => {
    expect(NationalId.create('MX', 'GOMA850101HQRRRN05').ok).toBe(false);
  });

  it('República Dominicana: acepta y formatea una cédula de 11 dígitos', () => {
    const result = NationalId.create('DO', '00113918205');
    expect(result.ok && result.value.format()).toBe('001-1391820-5');
  });

  it('Colombia: acepta y formatea una cédula de ciudadanía', () => {
    const result = NationalId.create('CO', '1020304050');
    expect(result.ok && result.value.format()).toBe('1.020.304.050');
  });
});
