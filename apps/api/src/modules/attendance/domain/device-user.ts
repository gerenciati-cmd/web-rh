import type { DeviceId } from './device';

/**
 * Registro de un usuario que el API puso en un checador: sin él no se podría cumplir "nunca
 * borrar lo que no creamos" (decisión 4 de organization-sedes) ni hallar el PIN viejo tras un
 * cambio de RFC. Valor plano, sin comportamiento.
 */
export interface DeviceUser {
  deviceId: DeviceId;
  /** PIN en el equipo = RFC del colaborador al momento de sincronizar. */
  pin: string;
  employeeId: string;
  syncedAt: Date;
}
