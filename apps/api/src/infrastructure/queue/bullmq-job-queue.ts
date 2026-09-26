import { Queue } from 'bullmq';

import type { JobQueue } from '@/shared/application/jobs';

export const DEFAULT_QUEUE = 'default';

export class BullMqJobQueue implements JobQueue {
  #queue: Queue | undefined;

  constructor(private readonly deps: { redisUrl: string }) {}

  /** Conexión perezosa: resolver el contenedor no abre sockets a Redis. */
  private get queue(): Queue {
    this.#queue ??= new Queue(DEFAULT_QUEUE, { connection: { url: this.deps.redisUrl } });
    return this.#queue;
  }

  async enqueue(name: string, data: object, options?: { delayMs?: number }) {
    await this.queue.add(name, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
      ...(options?.delayMs ? { delay: options.delayMs } : {}),
    });
  }

  async close(): Promise<void> {
    await this.#queue?.close();
  }
}
