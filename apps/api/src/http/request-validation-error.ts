import type { z } from 'zod';

/** La entrada HTTP no cumple el contrato. Es un error de ADAPTADOR, no de dominio. */
export class RequestValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';

  constructor(
    readonly location: 'params' | 'query' | 'body',
    readonly issues: z.core.$ZodIssue[],
  ) {
    super(`Solicitud inválida en ${location}`);
    this.name = 'RequestValidationError';
  }
}
