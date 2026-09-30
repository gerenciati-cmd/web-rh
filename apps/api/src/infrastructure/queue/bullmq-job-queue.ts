import { Queue } from 'bullmq';

import type { EnqueueOptions, JobQueue } from '@/shared/application/jobs';

export const DEFAULT_QUEUE = 'default';

export class BullMqJobQueue implements JobQueue {
  #queue: Queue | undefined;

  constructor(private readonly deps: { redisUrl: string }) {}

  /** Conexión perezosa: resolver el contenedor no abre sockets a Redis. */
  private get queue(): Queue {
    this.#queue ??= new Queue(DEFAULT_QUEUE, { connection: { url: this.deps.redisUrl } });
    return this.#queue;
  }

  async enqueue(name: string, data: object, options?: EnqueueOptions) {
    await this.queue.add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      // Un job sensible no deja su payload en Valkey (los demás conservan historial para depurar).
      removeOnComplete: options?.sensitive ? true : 1_000,
      removeOnFail: options?.sensitive ? true : 5_000,
      ...(options?.delayMs ? { delay: options.delayMs } : {}),
    });
  }

  async close(): Promise<void> {
    await this.#queue?.close();
  }
}
