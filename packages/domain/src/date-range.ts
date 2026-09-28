import { InvalidValueError } from './errors';
import { err, ok, type Result } from './result';

/** Vigencia inmutable [from, to), en milisegundos UTC; null significa sin término. */
export class DateRange {
  private constructor(
    private readonly fromMs: number,
    private readonly toMs: number | null,
  ) {}

  /** Rechaza fechas inválidas y término no posterior. No conserva referencias del caller. */
  static create(from: Date, to: Date | null = null): Result<DateRange, InvalidValueError> {
    const fromMs = from.getTime();
    const toMs = to?.getTime() ?? null;
    if (!Number.isFinite(fromMs) || (toMs !== null && !Number.isFinite(toMs))) {
      return err(new InvalidValueError('Las fechas del rango deben ser válidas'));
    }
    if (toMs !== null && toMs <= fromMs) {
      return err(new InvalidValueError('La fecha de término debe ser posterior al inicio'));
    }
    return ok(new DateRange(fromMs, toMs));
  }

  /** Copia defensiva: mutar el Date retornado no modifica la vigencia. */
  get from(): Date {
    return new Date(this.fromMs);
  }
  get to(): Date | null {
    return this.toMs === null ? null : new Date(this.toMs);
  }

  /** Una fecha inválida no pertenece a ningún rango. */
  contains(date: Date): boolean {
    const time = date.getTime();
    return Number.isFinite(time) && time >= this.fromMs && (this.toMs === null || time < this.toMs);
  }

  overlaps(other: DateRange): boolean {
    return (
      (other.toMs === null || this.fromMs < other.toMs) &&
      (this.toMs === null || this.toMs > other.fromMs)
    );
  }

  isOpenEnded(): boolean {
    return this.toMs === null;
  }
}
