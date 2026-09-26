import { InvalidValueError } from './errors';
import { err, ok, type Result } from './result';

/**
 * Vigencia [from, to). `to = null` significa "vigente indefinidamente".
 *
 * En RRHH casi todo tiene vigencia: sueldo, cargo, jornada, contrato. Se modela con
 * rangos en vez de sobrescribir, para poder recalcular un período pasado con los datos
 * que regían en ese momento.
 */
export class DateRange {
  private constructor(
    readonly from: Date,
    readonly to: Date | null,
  ) {}

  static create(from: Date, to: Date | null = null): Result<DateRange, InvalidValueError> {
    if (to !== null && to <= from) {
      return err(new InvalidValueError('La fecha de término debe ser posterior al inicio'));
    }
    return ok(new DateRange(from, to));
  }

  contains(date: Date): boolean {
    return date >= this.from && (this.to === null || date < this.to);
  }

  overlaps(other: DateRange): boolean {
    const startsBeforeOtherEnds = other.to === null || this.from < other.to;
    const endsAfterOtherStarts = this.to === null || this.to > other.from;
    return startsBeforeOtherEnds && endsAfterOtherStarts;
  }

  isOpenEnded(): boolean {
    return this.to === null;
  }
}
