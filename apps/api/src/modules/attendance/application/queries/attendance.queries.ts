import type { DeviceDto, ListPunchesQuery, Page, PageQuery, PunchDto } from '@rrhh/contracts';

/** Marcación sin dueño: el caso de uso la enriquece con el colaborador. */
export type RawPunch = Omit<PunchDto, 'employee'>;

/**
 * Puerto de LECTURA (lado query de CQRS ligero). Devuelve DTOs listos para la UI,
 * sin pasar por los agregados.
 */
export interface AttendanceQueries {
  listDevices(page: PageQuery): Promise<Page<DeviceDto>>;
  /**
   * Más recientes primero. `pins` restringe a esos PIN (un arreglo vacío no devuelve filas) y se
   * combina con AND con el filtro `pin`.
   */
  listPunches(
    filters: ListPunchesQuery & { pins?: readonly string[] | undefined },
  ): Promise<Page<RawPunch>>;
}
