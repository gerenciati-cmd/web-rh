import type { DeviceId } from './device';
import type { DeviceCommand } from './device-command';

export interface DeviceCommandRepository {
  /** Comandos nuevos y cierres con la respuesta del equipo. */
  save(command: DeviceCommand): Promise<void>;
  /** El comando en cola más antiguo del equipo, o null si no hay. */
  nextQueued(deviceId: DeviceId): Promise<DeviceCommand | null>;
  /**
   * Persiste un comando recién marcado como enviado solo si sigue en cola; `false` si otro
   * sondeo concurrente ya lo tomó.
   */
  claim(command: DeviceCommand): Promise<boolean>;
  /** Siguiente número `C:<n>:`, único entre todos los comandos. */
  nextNumber(): Promise<number>;
  /** Si hay un comando idéntico (sin prefijo) todavía en cola para ese equipo. */
  hasQueued(deviceId: DeviceId, command: string): Promise<boolean>;
  findByNumber(deviceId: DeviceId, number: number): Promise<DeviceCommand | null>;
}
