/**
 * Vocabulario de la regla "N retardos = 1 falta" (README de attendance-asistencia-diaria,
 * decisiones 26-30): cada empresa elige N y el periodo de conteo (semana lunes–domingo, quincena
 * 1–15 y 16–fin de mes, o mes calendario); la empresa sin regla usa 3 por quincena.
 */
export const LATENESS_PERIODS = ['WEEK', 'FORTNIGHT', 'MONTH'] as const;
export type LatenessPeriod = (typeof LATENESS_PERIODS)[number];

/** Regla que aplica a una empresa que nunca configuró una (decisión 29). */
export const DEFAULT_LATENESS_RULE = { threshold: 3, period: 'FORTNIGHT' } as const;

/** Mayor N que una empresa puede configurar. */
export const MAX_LATENESS_THRESHOLD = 31;
