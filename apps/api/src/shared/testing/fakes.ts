import type { DomainEvent } from '@rrhh/domain';

import type { Clock, EventBus, EventHandler, IdGenerator, Logger } from '../application/ports';

/**
 * Dobles de prueba deterministas para los puertos transversales.
 * Gracias a DIP, los casos de uso se testean sin BD, sin reloj real y sin red.
 */
export class FixedClock implements Clock {
  constructor(private current = new Date('2026-01-15T12:00:00Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  set(date: Date): void {
    this.current = date;
  }
}

export class SequentialIdGenerator implements IdGenerator {
  #counter = 0;

  next(): string {
    this.#counter += 1;
    return `00000000-0000-4000-8000-${String(this.#counter).padStart(12, '0')}`;
  }
}

export class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];

  publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }

  subscribe(_eventName: string, _handler: EventHandler): void {
    // no-op: los tests verifican lo publicado, no la entrega.
  }

  names(): string[] {
    return this.published.map((event) => event.name);
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class RecordingLogger implements Logger {
  readonly entries: { level: LogLevel; obj: object; msg?: string }[] = [];

  debug(obj: object, msg?: string): void {
    this.record('debug', obj, msg);
  }

  info(obj: object, msg?: string): void {
    this.record('info', obj, msg);
  }

  warn(obj: object, msg?: string): void {
    this.record('warn', obj, msg);
  }

  error(obj: object, msg?: string): void {
    this.record('error', obj, msg);
  }

  private record(level: LogLevel, obj: object, msg?: string): void {
    this.entries.push(msg === undefined ? { level, obj } : { level, obj, msg });
  }
}
