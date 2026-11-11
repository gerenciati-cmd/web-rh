import { DEFAULT_LATENESS_RULE, type LatenessPeriod } from '@rrhh/domain';

import { addDays, daysBetween } from './local-date';
import type { Workday } from './workday';

/**
 * Regla "N retardos = 1 falta" de una empresa desde `effectiveFrom` (README de
 * attendance-asistencia-diaria, decisiones 26-30). Valor plano; el historial de reglas conserva
 * las anteriores para los periodos que ya pasaron.
 */
export interface LatenessRule {
  companyId: string;
  /** Primer día `YYYY-MM-DD` en que rige. */
  effectiveFrom: string;
  threshold: number;
  period: LatenessPeriod;
  setAt: Date;
  setBy: string;
}

export interface LatenessSegment {
  start: string;
  end: string;
  threshold: number;
}

function lastDayOfMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  // Día 0 del mes siguiente = último del mes; solo aritmética de calendario en UTC.
  return new Date(Date.UTC(year ?? 0, month ?? 1, 0)).toISOString().slice(0, 10);
}

/**
 * Periodo de conteo que contiene `date` (decisión 26): semana de lunes a domingo, quincena (1–15
 * o 16–fin de mes) o mes calendario.
 */
export function latenessPeriodOf(
  date: string,
  period: LatenessPeriod,
): { start: string; end: string } {
  if (period === 'WEEK') {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const sinceMonday = (weekday + 6) % 7;
    const start = addDays(date, -sinceMonday);
    return { start, end: addDays(start, 6) };
  }
  const monthStart = `${date.slice(0, 8)}01`;
  if (period === 'MONTH') return { start: monthStart, end: lastDayOfMonth(date) };
  return Number(date.slice(8, 10)) <= 15
    ? { start: monthStart, end: `${date.slice(0, 8)}15` }
    : { start: `${date.slice(0, 8)}16`, end: lastDayOfMonth(date) };
}

/**
 * Tramos de conteo que tocan `[from, to]`. Para cada fecha rige la última regla con
 * `effectiveFrom <= fecha` (o la regla por defecto, hasta el día anterior a la primera) y el tramo
 * es el periodo de esa regla recortado a su vigencia: un periodo se corta en un cambio de regla
 * (decisión 30). Cada tramo sale una vez, ascendente y completo, sin recortar a `[from, to]`.
 * `rules` viene ordenado por `effectiveFrom` ascendente.
 */
export function latenessSegments(
  rules: readonly LatenessRule[],
  from: string,
  to: string,
): LatenessSegment[] {
  const segments = new Map<string, LatenessSegment>();
  const span = daysBetween(from, to);
  for (let offset = 0; offset <= span; offset++) {
    const date = addDays(from, offset);
    let index = -1;
    rules.forEach((rule, i) => {
      if (rule.effectiveFrom <= date) index = i;
    });
    const rule = index >= 0 ? rules[index] : undefined;
    const next = rules[index + 1];
    const { threshold, period } = rule ?? DEFAULT_LATENESS_RULE;
    const bounds = latenessPeriodOf(date, period);
    const validFrom = rule?.effectiveFrom ?? bounds.start;
    const validUntil = next ? addDays(next.effectiveFrom, -1) : bounds.end;
    const start = bounds.start > validFrom ? bounds.start : validFrom;
    const end = bounds.end < validUntil ? bounds.end : validUntil;
    segments.set(`${start}|${end}`, { start, end, threshold });
  }
  return [...segments.values()].sort((a, b) =>
    a.start < b.start ? -1 : a.start > b.start ? 1 : 0,
  );
}

/**
 * Cuenta de nuevo las jornadas de UN tramo: toda falta por retardos vuelve a asistencia y luego
 * cada N-ésimo retardo (en orden de fecha) se vuelve falta por retardos, conservando sus minutos
 * (decisiones 27 y 28: una falta por cada bloque completo de N, sin arrastrar el sobrante).
 * Devuelve objetos nuevos; `calculatedAt` solo cambia en los días cuyo estado cambió.
 */
export function applyLatenessRule(
  workdays: readonly Workday[],
  threshold: number,
  now: Date,
): Workday[] {
  const sorted = workdays
    .map((workday): Workday => ({
      ...workday,
      status: workday.status === 'ABSENT_LATENESS' ? 'ATTENDED' : workday.status,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let lateDays = 0;
  for (const workday of sorted) {
    if (workday.status !== 'ATTENDED' || workday.lateMinutes <= 0) continue;
    lateDays += 1;
    if (lateDays % threshold === 0) workday.status = 'ABSENT_LATENESS';
  }
  const original = new Map(workdays.map((workday) => [workday.date, workday.status]));
  return sorted.map((workday) =>
    original.get(workday.date) === workday.status ? workday : { ...workday, calculatedAt: now },
  );
}
