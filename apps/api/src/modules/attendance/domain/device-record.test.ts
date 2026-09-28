import { describe, expect, it } from 'vitest';

import { isDeviceIdentifier, LOGGABLE_DEVICE_FIELDS, redactDeviceFields } from './device-record';

// Regresión de la reparación de revisión (deviación 7, hallazgo L1): antes, cualquier clave o
// prefijo se aceptaba y se registraba tal cual, sin límite de forma ni de largo.
describe('isDeviceIdentifier', () => {
  it('acepta un identificador que empieza con letra, con dígitos y guion bajo', () => {
    expect(isDeviceIdentifier('PIN')).toBe(true);
    expect(isDeviceIdentifier('BIODATA')).toBe(true);
    expect(isDeviceIdentifier('Major_Ver2')).toBe(true);
  });

  it('rechaza un identificador que empieza con dígito', () => {
    expect(isDeviceIdentifier('1BIODATA')).toBe(false);
  });

  it('rechaza un identificador con espacios o símbolos', () => {
    expect(isDeviceIdentifier('ATT LOG')).toBe(false);
    expect(isDeviceIdentifier('ATT:LOG')).toBe(false);
    expect(isDeviceIdentifier('')).toBe(false);
  });

  it('acepta hasta 32 caracteres y rechaza 33', () => {
    expect(isDeviceIdentifier('A'.repeat(32))).toBe(true);
    expect(isDeviceIdentifier('A'.repeat(33))).toBe(false);
  });
});

describe('redactDeviceFields', () => {
  it('conserva un valor corto de una clave permitida', () => {
    const result = redactDeviceFields({ PIN: '1', DeviceName: 'SenseFace 2A' });

    expect(result).toEqual({ PIN: '1', DeviceName: 'SenseFace 2A' });
  });

  it('distingue PIN de Pin porque la comparación es exacta', () => {
    const result = redactDeviceFields({ PIN: '1', Pin: '2' });

    expect(result).toEqual({ PIN: '1', Pin: '2' });
  });

  it('redacta una clave no permitida aunque el valor sea corto', () => {
    const result = redactDeviceFields({ Name: 'Ana' });

    expect(result).toEqual({ Name: '[redactado:3]' });
  });

  it('redacta un valor permitido si supera los 64 caracteres', () => {
    const longValue = 'x'.repeat(65);
    const result = redactDeviceFields({ DeviceName: longValue });

    expect(result).toEqual({ DeviceName: '[redactado:65]' });
  });

  it('conserva un valor permitido de exactamente 64 caracteres', () => {
    const value = 'x'.repeat(64);
    const result = redactDeviceFields({ DeviceName: value });

    expect(result).toEqual({ DeviceName: value });
  });

  it('conserva todas las claves originales, redactadas o no', () => {
    const result = redactDeviceFields({ PIN: '1', Passwd: '1234', Tmp: 'x'.repeat(100) });

    expect(Object.keys(result)).toEqual(['PIN', 'Passwd', 'Tmp']);
    expect(result.PIN).toBe('1');
    expect(result.Passwd).toBe('[redactado:4]');
    expect(result.Tmp).toBe('[redactado:100]');
  });

  it('nunca deja pasar el contenido de un campo redactado', () => {
    const template = 'plantilla-biometrica-secreta';
    const result = redactDeviceFields({ Tmp: template });

    expect(Object.values(result).join(' ')).not.toContain(template);
  });

  it('excluye deliberadamente Name, Passwd, Card, ViceCard, Tmp y MAC de la lista permitida', () => {
    for (const key of ['Name', 'Passwd', 'Card', 'ViceCard', 'Tmp', 'MAC']) {
      expect(LOGGABLE_DEVICE_FIELDS.has(key)).toBe(false);
    }
  });
});
