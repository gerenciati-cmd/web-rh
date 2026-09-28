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

  /** Moneda distinta o desbordamiento devuelven err; nunca se construye un monto inseguro. */
  add(other: Money): Result<Money, InvalidValueError> {
    const currency = this.checkCurrency(other);
    if (!currency.ok) return currency;
    return Money.ofMinor(this.amountMinor + other.amountMinor, this.currency);
  }

  subtract(other: Money): Result<Money, InvalidValueError> {
    const currency = this.checkCurrency(other);
    if (!currency.ok) return currency;
    return Money.ofMinor(this.amountMinor - other.amountMinor, this.currency);
  }

  /**
   * Math.round conserva el redondeo actual: los empates van hacia +infinito.
   * No define una política legal de nómina. Factor no finito o resultado inseguro retorna err.
   */
  multiply(factor: number): Result<Money, InvalidValueError> {
    if (!Number.isFinite(factor)) return err(new InvalidValueError('El factor debe ser finito'));
    return Money.ofMinor(Math.round(this.amountMinor * factor), this.currency);
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

  private checkCurrency(other: Money): Result<void, InvalidValueError> {
    if (other.currency !== this.currency) {
      return err(
        new InvalidValueError('No se pueden operar montos de distinta moneda', {
          left: this.currency,
          right: other.currency,
        }),
      );
    }
    return ok(undefined);
  }
}
