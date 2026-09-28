import type { DomainEvent } from '@rrhh/domain';

import type { EventBus, EventHandler, Logger } from '@/shared/application/ports';

/**
 * Bus en proceso: el caller decide cuándo publicar después de persistir.
 * No programa callbacks post-commit ni asegura entrega durable.
 *
 * Limitación conocida: si el proceso cae entre el commit y el publish, el evento se pierde.
 * Cuando un evento no pueda perderse (p. ej. gatillar cálculo de nómina), migrar a
 * Transactional Outbox + BullMQ implementando ESTE MISMO puerto. Ver docs/adr/0005.
 */
export class InMemoryEventBus implements EventBus {
  readonly #handlers = new Map<string, EventHandler[]>();

  constructor(private readonly deps: { logger: Logger }) {}

  subscribe(eventName: string, handler: EventHandler): void {
    this.#handlers.set(eventName, [...(this.#handlers.get(eventName) ?? []), handler]);
  }

  async publish(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) {
      this.deps.logger.debug({ event: event.name }, 'domain event');
      const handlers = this.#handlers.get(event.name) ?? [];
      // Un handler que falla no debe impedir que los demás se ejecuten.
      const results = await Promise.allSettled(handlers.map((handler) => handler(event)));
      for (const result of results) {
        if (result.status === 'rejected') {
          this.deps.logger.error(
            { err: result.reason as unknown, event: event.name },
            'event handler failed',
          );
        }
      }
    }
  }
}
