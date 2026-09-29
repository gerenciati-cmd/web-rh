import type { ApiErrorBody } from '@rrhh/contracts';
import {
  AuthenticationError,
  BusinessRuleViolationError,
  ConflictError,
  DomainError,
  InvalidValueError,
  NotFoundError,
  TooManyRequestsError,
} from '@rrhh/domain';
import type { ErrorRequestHandler, RequestHandler } from 'express';

import type { Logger } from '@/shared/application/ports';

import { AuthenticationRequiredError } from './request-context';
import { RequestValidationError } from './request-validation-error';

/**
 * Mapa CATEGORÍA de error → status HTTP (OCP): una categoría nueva se agrega a la tabla,
 * sin tocar la lógica del handler. Los módulos NO conocen códigos HTTP.
 */
const STATUS_BY_CATEGORY: readonly (readonly [
  abstract new (...args: never[]) => DomainError,
  number,
])[] = [
  [NotFoundError, 404],
  [ConflictError, 409],
  [InvalidValueError, 422],
  [BusinessRuleViolationError, 422],
  [AuthenticationError, 401],
  [TooManyRequestsError, 429],
];

function statusFor(error: DomainError): number {
  return STATUS_BY_CATEGORY.find(([category]) => error instanceof category)?.[1] ?? 400;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, _next) => {
    if (error instanceof RequestValidationError) {
      const body: ApiErrorBody = {
        code: error.code,
        message: error.message,
        details: { location: error.location, issues: error.issues },
      };
      res.status(400).json(body);
      return;
    }

    if (error instanceof AuthenticationRequiredError) {
      const body: ApiErrorBody = { code: error.code, message: error.message };
      res.status(401).json(body);
      return;
    }

    if (error instanceof DomainError) {
      const body: ApiErrorBody = {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: { ...error.details } } : {}),
      };
      if (
        error instanceof TooManyRequestsError &&
        typeof error.details?.retryAfterSeconds === 'number'
      ) {
        res.set('Retry-After', String(error.details.retryAfterSeconds));
      }
      res.status(statusFor(error)).json(body);
      return;
    }

    // Inesperado: se loguea completo pero NUNCA se filtra el detalle al cliente.
    logger.error({ err: error }, 'unhandled error');
    const body: ApiErrorBody = { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' };
    res.status(500).json(body);
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    code: 'ROUTE_NOT_FOUND',
    message: `No existe ${req.method} ${req.path}`,
  };
  res.status(404).json(body);
};
