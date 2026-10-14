import type { Punch } from './punch';

export interface PunchRepository {
  /**
   * Guarda marcaciones nuevas. Los duplicados por `(deviceId, pin, deviceLocalTime)` se omiten en
   * silencio, no son un error: el equipo reenvía su historial completo en cada handshake.
   */
  saveNew(punches: readonly Punch[]): Promise<{ inserted: number }>;
  /**
   * Instantes (`occurredAt`) de las marcaciones de ese PIN con `from ≤ occurredAt < to`, de
   * cualquier checador, en orden ascendente.
   */
  listInstants(pin: string, from: Date, to: Date): Promise<Date[]>;
}
