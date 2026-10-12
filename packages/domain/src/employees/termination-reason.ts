/**
 * Motivos de baja de un colaborador: catálogo cerrado acordado con el negocio (README de
 * employees-desvinculacion, decisión 3), basado en la LFT (rescisión arts. 47 y 51, terminación
 * art. 53). El finiquito dependerá del motivo; persistencia mantiene su propio enum.
 */
export const TERMINATION_REASONS = [
  'VOLUNTARY_RESIGNATION',
  'DISMISSAL_WITH_CAUSE',
  'DISMISSAL_WITHOUT_CAUSE',
  'MUTUAL_AGREEMENT',
  'END_OF_CONTRACT',
  'DEATH',
  'INCAPACITY',
  'OTHER',
] as const;
export type TerminationReason = (typeof TERMINATION_REASONS)[number];
