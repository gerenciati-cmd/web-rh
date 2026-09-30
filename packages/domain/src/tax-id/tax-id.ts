import type { CountryCode } from '../country';
import { InvalidValueError } from '../errors';
import { err, ok, type Result } from '../result';

import { TAX_ID_VALIDATORS, type TaxIdValidator } from './validators';

/**
 * El tipo `CountryCode` no basta: filas de BD con un país que dejó de soportarse llegan con un
 * cast. Vista parcial del registro para que la búsqueda admita "sin validador".
 */
const validators: Partial<Record<string, TaxIdValidator>> = TAX_ID_VALIDATORS;

/**
 * Identificador tributario de una empresa (RFC persona moral, RNC, NIT). El de una persona es
 * `NationalId`. Delega la regla específica de cada país en su validador (patrón Strategy).
 */
export class TaxId {
  private constructor(
    readonly country: CountryCode,
    readonly value: string,
  ) {}

  static create(country: CountryCode, raw: string): Result<TaxId, InvalidValueError> {
    const validator = validators[country];
    if (!validator) {
      return err(new InvalidValueError('País no soportado', { country, value: raw }));
    }
    const normalized = validator.normalize(raw);
    if (!validator.isValid(normalized)) {
      return err(
        new InvalidValueError('Identificador tributario inválido', { country, value: raw }),
      );
    }
    return ok(new TaxId(country, normalized));
  }

  /** Validación pura reutilizable por formularios (web/mobile) y contratos. */
  static isValid(country: CountryCode, raw: string): boolean {
    const validator = validators[country];
    return validator?.isValid(validator.normalize(raw)) ?? false;
  }

  format(): string {
    return TAX_ID_VALIDATORS[this.country].format(this.value);
  }

  equals(other: TaxId): boolean {
    return this.country === other.country && this.value === other.value;
  }
}
