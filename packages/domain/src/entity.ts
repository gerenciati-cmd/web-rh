import type { DomainEvent } from './domain-event';

/**
 * Identificador tipado ("branded"): un `EmployeeId` no se puede pasar donde se espera
 * un `CompanyId` aunque ambos sean strings. Cero costo en runtime.
 */
export type Id<Brand extends string> = string & { readonly __brand: Brand };

/** Una entidad se identifica por su id, no por sus atributos. */
export abstract class Entity<TId extends string> {
  protected constructor(readonly id: TId) {}

  equals(other: Entity<TId>): boolean {
    return other.constructor === this.constructor && other.id === this.id;
  }
}

/**
 * Raíz de agregado: frontera de consistencia transaccional.
 * Registra eventos de dominio que la capa de aplicación publica tras persistir.
 */
export abstract class AggregateRoot<TId extends string> extends Entity<TId> {
  #events: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.#events.push(event);
  }

  /** Entrega y limpia los eventos pendientes (se llama una vez tras guardar). */
  pullEvents(): DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
