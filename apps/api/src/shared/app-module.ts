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
  /**
   * Router para equipos físicos que hablan su propio protocolo (p. ej. ZKTeco ADMS).
   * Se monta en la raíz, fuera de `/api/v1` y de los contratos (ADR 0008).
   */
  readonly deviceRouter?: (cradle: TCradle) => Router;
  /**
   * Paths que un equipo consulta constantemente (sondeo); una petición exitosa a ellos se
   * registra a nivel debug para no ahogar los logs. Los errores conservan su nivel.
   */
  readonly quietRequestPaths?: readonly string[];
  /** Suscripciones a eventos de otros módulos (comunicación desacoplada). */
  readonly subscribe?: (cradle: TCradle & { eventBus: EventBus }) => void;
  /** Handlers de jobs asíncronos que ejecuta el worker. */
  readonly jobs?: (cradle: TCradle) => JobHandler[];
}
