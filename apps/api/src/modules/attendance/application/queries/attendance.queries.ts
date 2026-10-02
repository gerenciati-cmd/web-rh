import type { DeviceDto, ListPunchesQuery, Page, PageQuery, PunchDto } from '@rrhh/contracts';

/**
 * Puerto de LECTURA (lado query de CQRS ligero). Devuelve DTOs listos para la UI,
 * sin pasar por los agregados.
 */
export interface AttendanceQueries {
  listDevices(page: PageQuery): Promise<Page<DeviceDto>>;
  /** Más recientes primero. Sin filtro de empresa: la marcación cruda aún no tiene empresa. */
  listPunches(filters: ListPunchesQuery): Promise<Page<PunchDto>>;
}
