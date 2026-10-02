import { describe, expect, it } from 'vitest';

import { InvalidValueError } from '../errors';

import { PersonalRfc } from './personal-rfc';

describe('PersonalRfc', () => {
  it('acepta un RFC de persona física y lo normaliza a mayúsculas', () => {
    const result = PersonalRfc.create('goma850101ab1');
    expect(result.ok && result.value.value).toBe('GOMA850101AB1');
  });

  it('ignora espacios y guiones al normalizar', () => {
    const result = PersonalRfc.create(' GOMA-850101 AB1 ');
    expect(result.ok && result.value.value).toBe('GOMA850101AB1');
  });

  it('acepta & y Ñ en las letras iniciales', () => {
    expect(PersonalRfc.isValid('Ñ&MA850101AB1')).toBe(true);
  });

  it('rechaza un RFC de persona moral (12 caracteres) con InvalidValueError y el valor original', () => {
    const result = PersonalRfc.create('EKU9003173C9');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(InvalidValueError);
    expect(!result.ok && result.error.message).toBe('RFC de persona física inválido');
    expect(!result.ok && result.error.details).toEqual({ value: 'EKU9003173C9' });
  });

  it.each([
    ['mes inexistente (13)', 'GOMA851301AB1'],
    ['día inexistente (30 de febrero)', 'GOMA850230AB1'],
    ['longitud mayor', 'GOMA850101AB12'],
    ['letras iniciales con dígitos', 'GO1A850101AB1'],
    ['vacío', ''],
  ])('rechaza %s', (_case, raw) => {
    expect(PersonalRfc.isValid(raw)).toBe(false);
    expect(PersonalRfc.create(raw).ok).toBe(false);
  });

  it('isValid coincide con create', () => {
    expect(PersonalRfc.isValid('goma850101ab1')).toBe(true);
  });

  it('equals compara por valor normalizado', () => {
    const a = PersonalRfc.create('goma850101ab1');
    const b = PersonalRfc.create('GOMA850101AB1');
    const c = PersonalRfc.create('GOMA850101AB2');
    if (!a.ok || !b.ok || !c.ok) throw new Error('fixture inválido');
    expect(a.value.equals(b.value)).toBe(true);
    expect(a.value.equals(c.value)).toBe(false);
  });
});
