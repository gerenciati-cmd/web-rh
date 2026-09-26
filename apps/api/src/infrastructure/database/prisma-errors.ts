/** Violación de restricción única (P2002). Última defensa ante carreras entre dos requests. */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}
