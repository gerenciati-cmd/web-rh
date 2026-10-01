import type { Punch } from './punch';

export interface PunchRepository {
  /**
   * Guarda marcaciones nuevas. Los duplicados por `(deviceId, pin, deviceLocalTime)` se omiten en
   * silencio, no son un error: el equipo reenvía su historial completo en cada handshake.
   */
  saveNew(punches: readonly Punch[]): Promise<{ inserted: number }>;
}
