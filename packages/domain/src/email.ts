import { InvalidValueError } from './errors';
import { err, ok, type Result } from './result';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Value object: inmutable, se valida al crearse y se compara por valor. */
export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Result<Email, InvalidValueError> {
    const normalized = raw.trim().toLowerCase();
    if (!EMAIL_PATTERN.test(normalized)) {
      return err(new InvalidValueError('Email inválido', { value: raw }));
    }
    return ok(new Email(normalized));
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
