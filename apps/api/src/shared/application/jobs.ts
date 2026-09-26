/**
 * Trabajo asíncrono (nómina, reportes, cierres de asistencia). El caso de uso encola
 * vía `JobQueue`; el worker ejecuta el `JobHandler` registrado con ese nombre.
 */
export interface JobQueue {
  enqueue(name: string, data: object, options?: { delayMs?: number }): Promise<void>;
}

export interface JobHandler<T = unknown> {
  readonly name: string;
  handle(data: T): Promise<void>;
}
