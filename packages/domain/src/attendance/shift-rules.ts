/**
 * Vocabulario y límites de los turnos de asistencia (README de attendance-asistencia-diaria,
 * decisiones 5, 6 y 12): la comida es un descuento fijo, la tolerancia de retardo es por turno y
 * el turno es un ciclo de días laborables o de descanso.
 */
export const SHIFT_DAY_TYPES = ['WORK', 'REST'] as const;
export type ShiftDayType = (typeof SHIFT_DAY_TYPES)[number];

export const MAX_SHIFT_CYCLE_DAYS = 28;
export const MAX_SHIFT_TOLERANCE_MINUTES = 60;
export const MAX_MEAL_BREAK_MINUTES = 120;
export const SHIFT_NAME_MAX_LENGTH = 100;
export const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
