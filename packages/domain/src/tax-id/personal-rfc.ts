import { normalizeIdentifier } from '../country';
import { InvalidValueError } from '../errors';
import { err, ok, type Result } from '../result';

import { isValidYymmdd } from './validators';

const PERSONAL_RFC_FORMAT = /^[A-Z&Ñ]{4}\d{6}[A-Z0-9]{3}$/;

/**
 * RFC de persona física mexicana (13 caracteres): formato y fecha de nacimiento real (AAMMDD).
 * Sin dígito verificador, por la misma razón que el RFC de persona moral (ver `validators.ts`).
 */
export class PersonalRfc {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<PersonalRfc, InvalidValueError> {
    const normalized = normalizeIdentifier(raw);
    if (!PersonalRfc.isNormalizedValid(normalized)) {
      return err(new InvalidValueError('RFC de persona física inválido', { value: raw }));
    }
    return ok(new PersonalRfc(normalized));
  }

  /** Validación pura reutilizable por contratos y formularios. */
  static isValid(raw: string): boolean {
    return PersonalRfc.isNormalizedValid(normalizeIdentifier(raw));
  }

  private static isNormalizedValid(normalized: string): boolean {
    return PERSONAL_RFC_FORMAT.test(normalized) && isValidYymmdd(normalized.slice(4, 10));
  }

  equals(other: PersonalRfc): boolean {
    return this.value === other.value;
  }
}
