import { PUNCH_WINDOW_MARGIN_MINUTES } from '@rrhh/domain';

import { addDays, localInstant } from './local-date';
import { workMinutes, type ShiftDay, type ShiftId, type WorkShiftDay } from './shift';
import type { Workday } from './workday';

/** Turno que aplica a una fecha del calendario; null = sin turno asignado ese día. */
export interface PlannedDate {
  date: string;
  plan: { shiftId: ShiftId; day: ShiftDay; toleranceMinutes: number } | null;
}

const MS_PER_MINUTE = 60_000;
const MARGIN_MS = PUNCH_WINDOW_MARGIN_MINUTES * MS_PER_MINUTE;
const DAY_MS = 24 * 60 * MS_PER_MINUTE;

function workDayOf(entry: PlannedDate | undefined): WorkShiftDay | null {
  return entry?.plan?.day.type === 'WORK' ? entry.plan.day : null;
}

function scheduledStart(date: string, day: WorkShiftDay, timeZone: string): Date {
  return localInstant(date, day.start, timeZone);
}

/** Salida programada: el mismo día, o el siguiente si la salida es menor o igual a la entrada. */
function scheduledEnd(date: string, day: WorkShiftDay, timeZone: string): Date {
  return localInstant(day.end <= day.start ? addDays(date, 1) : date, day.end, timeZone);
}

function minutesBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_MINUTE);
}

/**
 * Inicio de la ventana de marcaciones de cada fecha del calendario (plan 002, "The punch
 * window"). La ventana de la fecha `i` es `[b(i), b(i+1))`: nunca se traslapan y cubren todo el
 * tiempo. La primera entrada solo sirve de antecedente: no conoce el día anterior a ella.
 */
export function windowBoundaries(calendar: readonly PlannedDate[], timeZone: string): Date[] {
  const boundaries: Date[] = [];
  calendar.forEach((entry, index) => {
    const previous = index > 0 ? calendar[index - 1] : undefined;
    const previousWork = workDayOf(previous);
    const previousEnd =
      previous && previousWork ? scheduledEnd(previous.date, previousWork, timeZone) : null;
    const previousStart =
      previous && previousWork ? scheduledStart(previous.date, previousWork, timeZone) : null;
    const work = workDayOf(entry);

    let boundary: number;
    if (work) {
      const start = scheduledStart(entry.date, work, timeZone).getTime();
      boundary = start - MARGIN_MS;
      if (previousEnd && previousEnd.getTime() > boundary) {
        boundary =
          previousEnd.getTime() >= start ? start : Math.floor((previousEnd.getTime() + start) / 2);
      }
    } else {
      boundary = localInstant(entry.date, '00:00', timeZone).getTime();
      // La salida de un turno nocturno o de 24 h se queda con su día, y el día previo a un
      // descanso conserva el mismo alcance de 24 h que cualquier otro (revisión Low-3).
      if (previousEnd && previousStart) {
        boundary = Math.max(
          boundary,
          previousEnd.getTime() + MARGIN_MS,
          previousStart.getTime() + DAY_MS - MARGIN_MS,
        );
      }
    }
    const last = boundaries.at(-1);
    if (last) boundary = Math.max(boundary, last.getTime());
    boundaries.push(new Date(boundary));
  });
  return boundaries;
}

/**
 * Calcula las jornadas de las fechas pedidas: `calendar` trae fechas consecutivas de `from − 1` a
 * `to + 1` y solo `calendar[1..n]` producen resultado (los extremos dan las ventanas vecinas).
 *
 * Reglas (README de attendance-asistencia-diaria):
 * - La primera marcación de la ventana es la entrada y la última la salida (decisión 4).
 * - Día laborable sin marcaciones o con una sola = falta (decisión 7); con dos o más, asistencia:
 *   el retardo cuenta desde la entrada programada y solo si pasa la tolerancia (decisiones 6 y 15);
 *   lo trabajado descuenta la comida fija (decisión 5) y las horas extra son lo trabajado por
 *   encima de la jornada, incluida la llegada anticipada (decisión 14).
 * - Marcaciones en día de descanso = descanso trabajado, todo medido como horas extra (decisión
 *   16). Descanso sin marcaciones y días sin turno no generan jornada.
 * - La ventana de marcaciones es la regla teórica de margen fijo (decisión 17): un turno de 09:00
 *   a 18:00 capta de 05:00 a 05:00 del día siguiente, también si ese día es descanso (una salida
 *   del viernes a las 00:30 del sábado es tiempo extra del viernes); uno nocturno de 22:00 a 06:00
 *   capta de 18:00 de D a 18:00 de D+1, sea D+1 laborable a las 22:00 o descanso; uno de 24x24 de
 *   08:00 a 08:00 seguido de descanso capta de 04:00 de D a 12:00 de D+1.
 * - Solo hay jornadas entre la contratación y la baja, inclusive (decisión 18), y solo de fechas
 *   cerradas (su ventana ya terminó); las abiertas se reportan como pendientes.
 */
export function calculateWorkdays(input: {
  employeeId: string;
  companyId: string;
  calendar: readonly PlannedDate[];
  timeZone: string;
  punches: readonly Date[];
  employedFrom: string;
  employedUntil: string | null;
  now: Date;
}): { workdays: Workday[]; closedDates: string[]; pendingDates: string[] } {
  const { calendar, timeZone, now } = input;
  const boundaries = windowBoundaries(calendar, timeZone);
  const punches = [...input.punches].sort((a, b) => a.getTime() - b.getTime());
  const workdays: Workday[] = [];
  const closedDates: string[] = [];
  const pendingDates: string[] = [];

  for (let index = 1; index < calendar.length - 1; index += 1) {
    const entry = calendar[index];
    const windowStart = boundaries[index];
    const windowEnd = boundaries[index + 1];
    if (!entry || !windowStart || !windowEnd) continue;

    if (windowEnd.getTime() > now.getTime()) {
      pendingDates.push(entry.date);
      continue;
    }
    closedDates.push(entry.date);

    const employed =
      entry.date >= input.employedFrom &&
      (input.employedUntil === null || entry.date <= input.employedUntil);
    if (!employed || !entry.plan) continue;

    const inWindow = punches.filter(
      (punch) => punch.getTime() >= windowStart.getTime() && punch.getTime() < windowEnd.getTime(),
    );
    const workday = buildWorkday({
      employeeId: input.employeeId,
      companyId: input.companyId,
      date: entry.date,
      plan: entry.plan,
      timeZone,
      punches: inWindow,
      now,
    });
    if (workday) workdays.push(workday);
  }

  return { workdays, closedDates, pendingDates };
}

function buildWorkday(input: {
  employeeId: string;
  companyId: string;
  date: string;
  plan: NonNullable<PlannedDate['plan']>;
  timeZone: string;
  punches: readonly Date[];
  now: Date;
}): Workday | null {
  const { plan, punches } = input;
  const entry = punches[0] ?? null;
  const exit = punches.at(-1) ?? null;
  const base = {
    employeeId: input.employeeId,
    companyId: input.companyId,
    date: input.date,
    shiftId: plan.shiftId,
    firstPunchAt: entry,
    lastPunchAt: exit,
    punchCount: punches.length,
    calculatedAt: input.now,
  };

  if (plan.day.type === 'REST') {
    if (!entry || !exit) return null;
    const worked = minutesBetween(entry, exit);
    return {
      ...base,
      status: 'REST_WORKED',
      scheduledStartAt: null,
      scheduledEndAt: null,
      scheduledMinutes: 0,
      lateMinutes: 0,
      workedMinutes: worked,
      overtimeMinutes: worked,
    };
  }

  const day = plan.day;
  const start = scheduledStart(input.date, day, input.timeZone);
  const scheduled = {
    scheduledStartAt: start,
    scheduledEndAt: scheduledEnd(input.date, day, input.timeZone),
    scheduledMinutes: workMinutes(day),
  };
  if (!entry || !exit || punches.length < 2) {
    return {
      ...base,
      ...scheduled,
      status: punches.length === 0 ? 'ABSENT_NO_PUNCHES' : 'ABSENT_SINGLE_PUNCH',
      lateMinutes: 0,
      workedMinutes: 0,
      overtimeMinutes: 0,
    };
  }

  const late = minutesBetween(start, entry);
  const worked = Math.max(0, minutesBetween(entry, exit) - day.mealBreakMinutes);
  return {
    ...base,
    ...scheduled,
    status: 'ATTENDED',
    lateMinutes: late > plan.toleranceMinutes ? late : 0,
    workedMinutes: worked,
    overtimeMinutes: Math.max(0, worked - scheduled.scheduledMinutes),
  };
}
