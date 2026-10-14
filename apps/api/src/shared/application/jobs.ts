/**
 * Trabajo asíncrono (nómina, reportes, cierres de asistencia). El caso de uso encola
 * vía `JobQueue`; el worker ejecuta el `JobHandler` registrado con ese nombre.
 */
export interface EnqueueOptions {
  delayMs?: number;
  /**
   * El payload contiene secretos (p. ej. un token de activación en un enlace): no debe
   * conservarse en la cola al terminar, ni con éxito ni con fallo.
   */
  sensitive?: boolean;
}

export interface JobQueue {
  enqueue(name: string, data: object, options?: EnqueueOptions): Promise<void>;
}

export interface JobHandler<T = unknown> {
  readonly name: string;
  handle(data: T): Promise<void>;
}

/**
 * Job recurrente que declara un módulo (ADR 0016). `pattern` es una expresión cron y `timeZone`
 * una zona IANA (p. ej. `America/Cancun`) con la que se interpreta. Lo ejecuta el `JobHandler`
 * registrado con el mismo `name`.
 */
export interface ScheduledJob {
  name: string;
  pattern: string;
  timeZone: string;
}

export interface JobScheduler {
  upsert(job: ScheduledJob): Promise<void>;
}
