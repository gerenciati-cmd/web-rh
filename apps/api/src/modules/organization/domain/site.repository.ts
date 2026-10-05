import type { Result } from '@rrhh/domain';

import type { SiteAlreadyExistsError } from './errors';
import type { Site, SiteId } from './site';

/**
 * Puerto de ESCRITURA (lado command). Trabaja con agregados completos.
 * Nada de métodos "para pantallas": eso va en `SiteQueries`.
 */
export interface SiteRepository {
  findById(id: SiteId): Promise<Site | null>;
  /** Sin distinguir mayúsculas y con el nombre recortado. */
  existsByName(name: string): Promise<boolean>;
  /** Conflictos esperados retornan err; fallas de IO inesperadas rechazan la promesa. */
  save(site: Site): Promise<Result<void, SiteAlreadyExistsError>>;
}
