import type { Server } from 'node:http';

import type { Logger } from '@/shared/application/ports';

interface ShutdownDeps {
  server: Pick<Server, 'close' | 'closeAllConnections'>;
  dispose: () => Promise<void>;
  logger: Pick<Logger, 'info' | 'error'>;
  exit: (code: number) => void;
  timeoutMs?: number;
}

/** Comparte el cierre entre señales y conserva las dependencias mientras haya peticiones. */
export function createHttpShutdown(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shutdown: Promise<void> | undefined;

  return (signal) => {
    if (shutdown) return shutdown;
    let complete: () => void = () => undefined;
    shutdown = new Promise<void>((resolve) => {
      complete = resolve;
    });
    let finished = false;
    const isFinished = () => finished;
    const finish = (code: number) => {
      if (isFinished()) return;
      finished = true;
      clearTimeout(timer);
      complete();
      deps.exit(code);
    };
    const timer = setTimeout(() => {
      deps.logger.error({ signal }, 'Se agotó el plazo de apagado del API');
      try {
        deps.server.closeAllConnections();
      } finally {
        finish(1);
      }
    }, deps.timeoutMs ?? 8_000);

    deps.logger.info({ signal }, 'Apagando API');
    void (async () => {
      let code = 0;
      try {
        await new Promise<void>((resolve, reject) => {
          deps.server.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      } catch (error) {
        if (isFinished()) return;
        code = 1;
        deps.logger.error({ err: error }, 'No se pudo cerrar el servidor HTTP');
      }
      if (isFinished()) return;
      try {
        await deps.dispose();
      } catch (error) {
        if (isFinished()) return;
        code = 1;
        deps.logger.error({ err: error }, 'No se pudieron liberar las dependencias del API');
      }
      finish(code);
    })();
    return shutdown;
  };
}
