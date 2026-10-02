import type { SiteDto } from '@rrhh/contracts';
import type { CountryCode } from '@rrhh/domain';

import type { Site as SiteRow } from '@/infrastructure/database/generated/client';

import { Site, type SiteId } from '../domain/site';

/**
 * Traductor entre el mundo de persistencia (filas Prisma) y el dominio/DTOs.
 * Es el ÚNICO lugar donde conviven ambos tipos: ninguno se filtra al otro lado.
 */
export const SiteMapper = {
  toDomain(row: SiteRow): Site {
    return Site.restore(row.id as SiteId, {
      name: row.name,
      country: row.country as CountryCode,
      timeZone: row.timeZone,
      active: row.active,
      createdAt: row.createdAt,
    });
  },

  toPersistence(site: Site) {
    return {
      id: site.id,
      name: site.name,
      // Unicidad sin distinguir mayúsculas: el índice único vive sobre esta clave.
      nameKey: site.name.trim().toLowerCase(),
      country: site.country,
      timeZone: site.timeZone,
      active: site.active,
      createdAt: site.createdAt,
    };
  },

  toDto(
    row: Pick<SiteRow, 'id' | 'name' | 'country' | 'timeZone' | 'active' | 'createdAt'>,
  ): SiteDto {
    return {
      id: row.id,
      name: row.name,
      country: row.country as CountryCode,
      timeZone: row.timeZone,
      active: row.active,
      createdAt: row.createdAt.toISOString(),
    };
  },
};
