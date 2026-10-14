import {
  AggregateRoot,
  err,
  InvalidValueError,
  MAX_MEAL_BREAK_MINUTES,
  MAX_SHIFT_CYCLE_DAYS,
  MAX_SHIFT_TOLERANCE_MINUTES,
  ok,
  SHIFT_NAME_MAX_LENGTH,
  SHIFT_TIME_PATTERN,
  type Id,
  type Result,
} from '@rrhh/domain';

export type ShiftId = Id<'Shift'>;

export type ShiftDay =
  { type: 'REST' } | { type: 'WORK'; start: string; end: string; mealBreakMinutes: number };

export type WorkShiftDay = Extract<ShiftDay, { type: 'WORK' }>;

export interface ShiftProps {
  companyId: string;
  name: string;
  /** Nombre en minúsculas: la unicidad por empresa no distingue mayúsculas. */
  nameKey: string;
  /** Fecha (`YYYY-MM-DD`) en la que cae el día 1 del ciclo. */
  cycleStartDate: string;
  toleranceMinutes: number;
  days: readonly ShiftDay[];
  active: boolean;
  createdAt: Date;
}

const MINUTES_PER_DAY = 1440;
const MS_PER_DAY = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

/** Duración bruta de una jornada; salida ≤ entrada = termina al día siguiente (igual = 24 h). */
function grossMinutes(day: WorkShiftDay): number {
  const diff = toMinutes(day.end) - toMinutes(day.start);
  return diff <= 0 ? diff + MINUTES_PER_DAY : diff;
}

/** Minutos trabajados de un día laborable: la jornada menos la comida fija (decisión 5). */
export function workMinutes(day: WorkShiftDay): number {
  return grossMinutes(day) - day.mealBreakMinutes;
}

function utcDay(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function isCalendarDate(date: string): boolean {
  if (!DATE_PATTERN.test(date)) return false;
  return new Date(utcDay(date)).toISOString().slice(0, 10) === date;
}

function validateDays(days: readonly ShiftDay[]): InvalidValueError | null {
  if (days.length < 1 || days.length > MAX_SHIFT_CYCLE_DAYS) {
    return new InvalidValueError(`El ciclo debe tener de 1 a ${MAX_SHIFT_CYCLE_DAYS} días`);
  }
  if (!days.some((day) => day.type === 'WORK')) {
    return new InvalidValueError('El turno necesita al menos un día laborable');
  }
  for (const day of days) {
    if (day.type === 'REST') continue;
    if (!SHIFT_TIME_PATTERN.test(day.start) || !SHIFT_TIME_PATTERN.test(day.end)) {
      return new InvalidValueError('Hora de entrada o salida inválida (HH:mm)');
    }
    if (
      !Number.isInteger(day.mealBreakMinutes) ||
      day.mealBreakMinutes < 0 ||
      day.mealBreakMinutes > MAX_MEAL_BREAK_MINUTES
    ) {
      return new InvalidValueError(`La comida debe ser de 0 a ${MAX_MEAL_BREAK_MINUTES} minutos`);
    }
    if (day.mealBreakMinutes >= grossMinutes(day)) {
      return new InvalidValueError('La comida debe ser menor que la jornada');
    }
  }
  return null;
}

/**
 * Agregado Shift: un turno de una empresa como ciclo de días laborables y de descanso anclado a
 * una fecha (README de attendance-asistencia-diaria, decisión 12). Cubre turnos fijos, rotativos
 * y nocturnos con un solo modelo.
 */
export class Shift extends AggregateRoot<ShiftId> {
  private constructor(
    id: ShiftId,
    private readonly props: ShiftProps,
  ) {
    super(id);
  }

  /** Alta de un turno: revalida las reglas del contrato para no depender de la capa HTTP. */
  static create(input: {
    id: ShiftId;
    companyId: string;
    name: string;
    cycleStartDate: string;
    toleranceMinutes: number;
    days: readonly ShiftDay[];
    now: Date;
  }): Result<Shift, InvalidValueError> {
    const name = input.name.trim();
    if (name.length < 1) return err(new InvalidValueError('El nombre del turno es obligatorio'));
    if (name.length > SHIFT_NAME_MAX_LENGTH) {
      return err(new InvalidValueError('El nombre del turno es demasiado largo'));
    }
    if (!isCalendarDate(input.cycleStartDate)) {
      return err(new InvalidValueError('Fecha de inicio del ciclo inválida'));
    }
    if (
      !Number.isInteger(input.toleranceMinutes) ||
      input.toleranceMinutes < 0 ||
      input.toleranceMinutes > MAX_SHIFT_TOLERANCE_MINUTES
    ) {
      return err(
        new InvalidValueError(
          `La tolerancia debe ser de 0 a ${MAX_SHIFT_TOLERANCE_MINUTES} minutos`,
        ),
      );
    }
    const invalidDays = validateDays(input.days);
    if (invalidDays) return err(invalidDays);

    return ok(
      new Shift(input.id, {
        companyId: input.companyId,
        name,
        nameKey: name.toLowerCase(),
        cycleStartDate: input.cycleStartDate,
        toleranceMinutes: input.toleranceMinutes,
        days: input.days.map((day) => ({ ...day })),
        active: true,
        createdAt: input.now,
      }),
    );
  }

  /** Rehidratación desde persistencia: el dato ya fue validado al crearse; no emite eventos. */
  static restore(id: ShiftId, props: ShiftProps): Shift {
    return new Shift(id, props);
  }

  get companyId(): string {
    return this.props.companyId;
  }

  get name(): string {
    return this.props.name;
  }

  get nameKey(): string {
    return this.props.nameKey;
  }

  get cycleStartDate(): string {
    return this.props.cycleStartDate;
  }

  get toleranceMinutes(): number {
    return this.props.toleranceMinutes;
  }

  get days(): readonly ShiftDay[] {
    return this.props.days;
  }

  get active(): boolean {
    return this.props.active;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  /**
   * Día del ciclo que cae en `date` (`YYYY-MM-DD`). El ciclo se repite también hacia atrás de
   * `cycleStartDate`. Un turno nocturno pertenece a la fecha en que empieza (decisión 12).
   */
  dayOn(date: string): ShiftDay {
    const count = this.props.days.length;
    const elapsed = Math.round((utcDay(date) - utcDay(this.props.cycleStartDate)) / MS_PER_DAY);
    const index = ((elapsed % count) + count) % count;
    const day = this.props.days[index];
    if (!day) throw new Error('Ciclo de turno vacío');
    return day;
  }
}
