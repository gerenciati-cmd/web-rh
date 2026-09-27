import { createServer } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createHttpShutdown } from './http-shutdown';

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<void>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const server = createServer();
  let onClose: ((error?: Error) => void) | undefined;
  const close = vi.spyOn(server, 'close').mockImplementation((callback) => {
    onClose = callback;
    return server;
  });
  const force = vi.spyOn(server, 'closeAllConnections').mockImplementation(() => undefined);
  const cleanup = deferred();
  const dispose = vi.fn(() => cleanup.promise);
  const exit = vi.fn();
  const logger = { info: vi.fn(), error: vi.fn() };
  const shutdown = createHttpShutdown({ server, dispose, exit, logger, timeoutMs: 100 });
  const drained = async (error?: Error) => {
    onClose?.(error);
    await Promise.resolve();
  };
  return { shutdown, close, force, cleanup, dispose, exit, logger, drained };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('apagado del API', () => {
  it('espera las peticiones y después espera liberar dependencias', async () => {
    const h = setup();
    const completion = h.shutdown('SIGTERM');
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.dispose).not.toHaveBeenCalled();
    expect(h.exit).not.toHaveBeenCalled();
    await h.drained();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.exit).not.toHaveBeenCalled();
    h.cleanup.resolve();
    await completion;
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(h.force).not.toHaveBeenCalled();
  });

  it('comparte el cierre entre señales repetidas o distintas', async () => {
    const h = setup();
    const first = h.shutdown('SIGTERM');
    expect(h.shutdown('SIGINT')).toBe(first);
    await h.drained();
    h.cleanup.resolve();
    await first;
    expect(h.shutdown('SIGTERM')).toBe(first);
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledOnce();
  });

  it('corta peticiones atascadas al vencer el plazo y descarta callbacks tardíos', async () => {
    const h = setup();
    const completion = h.shutdown('SIGINT');
    await vi.advanceTimersByTimeAsync(100);
    await completion;
    expect(h.force).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    await h.drained();
    expect(h.dispose).not.toHaveBeenCalled();
    expect(h.exit).toHaveBeenCalledOnce();
  });

  for (const reject of [false, true]) {
    it(`limita también la liberación de dependencias y observa su ${reject ? 'rechazo' : 'resolución'} tardía`, async () => {
      const h = setup();
      const completion = h.shutdown('SIGTERM');
      await h.drained();
      await vi.advanceTimersByTimeAsync(100);
      await completion;
      if (reject) h.cleanup.reject(new Error('fallo tardío'));
      else h.cleanup.resolve();
      await Promise.resolve();
      expect(h.dispose).toHaveBeenCalledOnce();
      expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    });
  }

  it('intenta liberar dependencias si falla el cierre HTTP y devuelve error', async () => {
    const h = setup();
    const completion = h.shutdown('SIGTERM');
    await h.drained(new Error('fallo de cierre'));
    h.cleanup.resolve();
    await completion;
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(h.logger.error).toHaveBeenCalledOnce();
  });

  it('observa el rechazo de liberación y termina con error sin repetirla', async () => {
    const h = setup();
    const completion = h.shutdown('SIGINT');
    await h.drained();
    h.cleanup.reject(new Error('fallo de liberación'));
    await completion;
    expect(h.dispose).toHaveBeenCalledOnce();
    expect(h.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
