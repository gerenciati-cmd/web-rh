import type { Result } from '@rrhh/domain';

import type { Device, DeviceId } from './device';
import type { DeviceAlreadyRegisteredError } from './errors';

/**
 * Las escrituras son dirigidas por grupo de columnas: el equipo (contacto, desfase) y el
 * administrador (sede, redes) escriben en paralelo, y guardar la fila completa con un agregado
 * cargado antes haría que uno deshiciera en silencio el cambio del otro (hallazgo
 * `attendance-escritura-completa-del-equipo`).
 */
export interface DeviceRepository {
  findById(id: DeviceId): Promise<Device | null>;
  findBySerialNumber(serialNumber: string): Promise<Device | null>;
  /** Alta de un equipo nuevo. Un serial repetido retorna err; fallas de IO rechazan la promesa. */
  add(device: Device): Promise<Result<void, DeviceAlreadyRegisteredError>>;
  /** Lo que escribe el equipo: `lastSeenAt`, `lastSeenIp` y el desfase de reloj. */
  saveContact(device: Device): Promise<void>;
  /** Lo que escribe el administrador al cambiar la sede: `siteId` y `timeZone`. */
  saveSite(device: Device): Promise<void>;
  /** Lo que escribe el administrador al definir la barrera de red: `allowedNetworks`. */
  saveAllowedNetworks(device: Device): Promise<void>;
}
