import type { CountryCode } from '../country';
import { InvalidValueError } from '../errors';
import { err, ok, type Result } from '../result';

import { NATIONAL_ID_VALIDATORS, type NationalIdValidator } from './validators';

/**
 * El tipo `CountryCode` no basta: filas de BD con un país que dejó de soportarse llegan con un
 * cast. Vista parcial del registro para que la búsqueda admita "sin validador".
 */
const validators: Partial<Record<string, NationalIdValidator>> = NATIONAL_ID_VALIDATORS;

/**
 * Documento de identidad de una persona (CURP, cédula…). El de una empresa es `TaxId`.
 * Delega la regla específica de cada país en su validador (patrón Strategy).
 */
export class NationalId {
  private constructor(
    readonly country: CountryCode,
    readonly value: string,
  ) {}

  static create(country: CountryCode, raw: string): Result<NationalId, InvalidValueError> {
    const validator = validators[country];
    if (!validator) {
      return err(new InvalidValueError('País no soportado', { country, value: raw }));
    }
    const normalized = validator.normalize(raw);
    if (!validator.isValid(normalized)) {
      return err(new InvalidValueError('Documento de identidad inválido', { country, value: raw }));
    }
    return ok(new NationalId(country, normalized));
  }

  /** Validación pura reutilizable por formularios (web/mobile) y contratos. */
  static isValid(country: CountryCode, raw: string): boolean {
    const validator = validators[country];
    return validator?.isValid(validator.normalize(raw)) ?? false;
  }

  format(): string {
    return NATIONAL_ID_VALIDATORS[this.country].format(this.value);
  }

  equals(other: NationalId): boolean {
    return this.country === other.country && this.value === other.value;
  }
}
