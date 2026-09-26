import type { ApiErrorBody } from '@rrhh/contracts';

/** Error HTTP con el `code` estable del backend, listo para mapear a mensajes de UI. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: ApiErrorBody['details'],
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static isApiError(value: unknown): value is ApiError {
    return value instanceof ApiError;
  }
}
