/**
 * Base de todos los errores de dominio. `code` es estable y legible por máquinas:
 * la capa HTTP lo traduce a status codes y los clientes lo usan para i18n.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Un valor no cumple una invariante (RUT inválido, email mal formado, monto negativo...). */
export class InvalidValueError extends DomainError {
  readonly code: string = 'INVALID_VALUE';
}

/** Una regla de negocio impide la operación (p. ej. contratar en una empresa inactiva). */
export class BusinessRuleViolationError extends DomainError {
  readonly code: string = 'BUSINESS_RULE_VIOLATION';
}

/**
 * Categorías abstractas: cada módulo define su error concreto con un `code` propio
 * (`COMPANY_NOT_FOUND`), y la capa HTTP mapea la CATEGORÍA a un status (404, 409).
 */
export abstract class NotFoundError extends DomainError {}

export abstract class ConflictError extends DomainError {}
