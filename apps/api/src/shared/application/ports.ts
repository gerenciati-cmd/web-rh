import type { DomainEvent } from '@rrhh/domain';

/**
 * Puertos transversales de la capa de aplicación. Los casos de uso dependen de
 * estas ABSTRACCIONES (DIP); `infrastructure/` provee las implementaciones.
 * En tests se reemplazan por dobles deterministas sin tocar el caso de uso.
 */

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
  subscribe(eventName: string, handler: EventHandler): void;
}

export type EventHandler = (event: DomainEvent) => Promise<void>;

/**
 * Ejecuta `work` dentro de una transacción. Los repositorios usados dentro participan
 * automáticamente (propagación por AsyncLocalStorage), sin recibir el `tx` por parámetro.
 * Usar SOLO cuando un comando escribe más de un agregado.
 */
export interface TransactionRunner {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface Logger {
  debug(obj: object, msg?: string): void;
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface HealthCheck {
  readonly name: string;
  check(): Promise<boolean>;
}
