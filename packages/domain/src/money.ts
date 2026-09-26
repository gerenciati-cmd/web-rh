import { InvalidValueError } from './errors';
import { err, ok, type Result } from './result';

export type Currency = 'CLP' | 'CLF' | 'PEN' | 'USD';

/** Decimales de la unidad mínima por moneda (CLP no tiene centavos; la UF usa 4). */
const MINOR_UNIT_DIGITS: Readonly<Record<Currency, number>> = {
  CLP: 0,
  CLF: 4,
  PEN: 2,
  USD: 2,
};

/**
 * Dinero como ENTERO en la unidad mínima de su moneda. Nunca `float` para montos:
 * 0.1 + 0.2 !== 0.3 y en una liquidación eso es un error legal, no cosmético.
 */
export class Money {
  private constructor(
    readonly amountMinor: number,
    readonly currency: Currency,
  ) {}

  static ofMinor(amountMinor: number, currency: Currency): Result<Money, InvalidValueError> {
    if (!Number.isSafeInteger(amountMinor)) {
      return err(new InvalidValueError('El monto debe ser un entero seguro', { amountMinor }));
    }
    return ok(new Money(amountMinor, currency));
  }

  static zero(currency: Currency): Money {
    return new Money(0, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountMinor - other.amountMinor, this.currency);
  }

  /** Multiplica por un factor (p. ej. horas extra × 1.5) redondeando a la unidad mínima. */
  multiply(factor: number): Money {
    return new Money(Math.round(this.amountMinor * factor), this.currency);
  }

  isNegative(): boolean {
    return this.amountMinor < 0;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor;
  }

  toDecimalString(): string {
    const digits = MINOR_UNIT_DIGITS[this.currency];
    return (this.amountMinor / 10 ** digits).toFixed(digits);
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      // Mezclar monedas es un bug de programación, no un caso de negocio esperado.
      throw new InvalidValueError('No se pueden operar montos de distinta moneda', {
        left: this.currency,
        right: other.currency,
      });
    }
  }
}
