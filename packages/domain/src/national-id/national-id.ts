import type { CountryCode } from '../country';
import { InvalidValueError } from '../errors';
import { err, ok, type Result } from '../result';

import { NATIONAL_ID_VALIDATORS } from './validators';

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
    const validator = NATIONAL_ID_VALIDATORS[country];
    const normalized = validator.normalize(raw);
    if (!validator.isValid(normalized)) {
      return err(new InvalidValueError('Documento de identidad inválido', { country, value: raw }));
    }
    return ok(new NationalId(country, normalized));
  }

  /** Validación pura reutilizable por formularios (web/mobile) y contratos. */
  static isValid(country: CountryCode, raw: string): boolean {
    const validator = NATIONAL_ID_VALIDATORS[country];
    return validator.isValid(validator.normalize(raw));
  }

  format(): string {
    return NATIONAL_ID_VALIDATORS[this.country].format(this.value);
  }

  equals(other: NationalId): boolean {
    return this.country === other.country && this.value === other.value;
  }
}
