import type { Resolver } from 'awilix';
import type { Router } from 'express';

import type { JobHandler } from './application/jobs';
import type { EventBus } from './application/ports';

/**
 * Contrato que cumple cada módulo de negocio para enchufarse al monolito.
 * El composition root recorre la lista de módulos: agregar uno NO modifica
 * el código existente, solo la lista (Open/Closed).
 */
export interface AppModule<TCradle extends object> {
  readonly name: string;
  /** Registro DI: todas las claves del cradle del módulo, con su implementación. */
  readonly registrations: { [K in keyof TCradle]: Resolver<TCradle[K]> };
  /** Router HTTP del módulo, montado bajo `/api/v1`. */
  readonly router?: (cradle: TCradle) => Router;
  /** Suscripciones a eventos de otros módulos (comunicación desacoplada). */
  readonly subscribe?: (cradle: TCradle & { eventBus: EventBus }) => void;
  /** Handlers de jobs asíncronos que ejecuta el worker. */
  readonly jobs?: (cradle: TCradle) => JobHandler[];
}
