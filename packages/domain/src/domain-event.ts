/**
 * Hecho de negocio ya ocurrido, nombrado en pasado: `employees.employee.hired`.
 * Es el mecanismo para que un módulo reaccione a otro SIN importarlo directamente.
 */
export interface DomainEvent<TName extends string = string, TPayload = unknown> {
  readonly name: TName;
  readonly occurredAt: Date;
  readonly payload: TPayload;
}

export function createEvent<TName extends string, TPayload>(
  name: TName,
  payload: TPayload,
  occurredAt: Date = new Date(),
): DomainEvent<TName, TPayload> {
  return { name, payload, occurredAt };
}
