/**
 * Vocabulario y límites de las jornadas diarias de asistencia (README de
 * attendance-asistencia-diaria, decisiones 7 y 14–17): una falta es un día laborable sin
 * marcaciones o con una sola; el descanso trabajado se mide completo como horas extra; las
 * marcaciones se atribuyen a su día con una ventana de margen fijo.
 */
export const WORKDAY_STATUSES = [
  'ATTENDED',
  'ABSENT_NO_PUNCHES',
  'ABSENT_SINGLE_PUNCH',
  'REST_WORKED',
] as const;
export type WorkdayStatus = (typeof WORKDAY_STATUSES)[number];

/** Margen (minutos) antes de la entrada y después de la salida para atribuir marcaciones a un día. */
export const PUNCH_WINDOW_MARGIN_MINUTES = 240;

/** Máximo de días (inclusive) que se recalculan o consultan en una sola petición. */
export const MAX_WORKDAY_RANGE_DAYS = 62;
