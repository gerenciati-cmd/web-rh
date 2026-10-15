import { beforeEach, describe, expect, it, vi } from 'vitest';

const add = vi.fn();
const upsertJobScheduler = vi.fn();
const close = vi.fn();
const queueCtor = vi.fn();

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(...args: unknown[]) {
      queueCtor(...args);
    }
    add = add;
    upsertJobScheduler = upsertJobScheduler;
    close = close;
  },
}));

import { BullMqJobQueue, KEEP_COMPLETED_JOBS, KEEP_FAILED_JOBS } from './bullmq-job-queue';

describe('BullMqJobQueue (Queue de bullmq mockeado, sin Valkey)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('no abre la conexión hasta el primer uso', () => {
    new BullMqJobQueue({ redisUrl: 'redis://x' });
    expect(queueCtor).not.toHaveBeenCalled();
  });

  it('upsert usa el nombre como id y topa el historial del job programado', async () => {
    const queue = new BullMqJobQueue({ redisUrl: 'redis://x' });
    await queue.upsert({
      name: 'attendance.close-workdays',
      pattern: '5 * * * *',
      timeZone: 'America/Cancun',
    });

    expect(upsertJobScheduler).toHaveBeenCalledWith(
      'attendance.close-workdays',
      { pattern: '5 * * * *', tz: 'America/Cancun' },
      {
        name: 'attendance.close-workdays',
        data: {},
        opts: { removeOnComplete: KEEP_COMPLETED_JOBS, removeOnFail: KEEP_FAILED_JOBS },
      },
    );
  });

  it('enqueue de un job normal conserva historial con los mismos topes', async () => {
    const queue = new BullMqJobQueue({ redisUrl: 'redis://x' });
    await queue.enqueue('job', { a: 1 });

    expect(add).toHaveBeenCalledWith(
      'job',
      { a: 1 },
      expect.objectContaining({
        removeOnComplete: KEEP_COMPLETED_JOBS,
        removeOnFail: KEEP_FAILED_JOBS,
      }),
    );
  });

  it('enqueue de un job sensible no deja historial (true)', async () => {
    const queue = new BullMqJobQueue({ redisUrl: 'redis://x' });
    await queue.enqueue('job', { a: 1 }, { sensitive: true });

    expect(add).toHaveBeenCalledWith(
      'job',
      { a: 1 },
      expect.objectContaining({ removeOnComplete: true, removeOnFail: true }),
    );
  });
});
