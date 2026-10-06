import type { Result } from '@rrhh/domain';

import type { Device, DeviceId } from './device';
import type { DeviceAlreadyRegisteredError } from './errors';

/**
 * Un equipo existente lo cambian a la vez su propio tráfico (contacto, marcaciones) y el
 * administrador (sede): cada caso de uso escribe solo sus columnas para no pisar al otro
 * (hallazgo `attendance-escritura-completa-del-equipo`).
 */
export interface DeviceRepository {
  findById(id: DeviceId): Promise<Device | null>;
  findBySerialNumber(serialNumber: string): Promise<Device | null>;
  /**
   * Upsert completo: solo para dar de alta un equipo nuevo. Conflictos esperados retornan err;
   * fallas de IO inesperadas rechazan la promesa.
   */
  save(device: Device): Promise<Result<void, DeviceAlreadyRegisteredError>>;
  /** Escribe solo `lastSeenAt`, `clockOffsetSeconds` y `clockOffsetMeasuredAt` (tráfico del equipo). */
  saveActivity(device: Device): Promise<void>;
  /** Escribe solo `siteId` y `timeZone` (lo cambia el administrador). */
  saveSite(device: Device): Promise<void>;
}
