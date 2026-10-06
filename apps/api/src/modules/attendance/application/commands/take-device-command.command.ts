import type { Clock, Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';

interface Deps {
  deviceCommandRepository: DeviceCommandRepository;
  clock: Clock;
  logger: Logger;
}

/**
 * Intentos ante sondeos concurrentes del mismo equipo; si se pierden todos, el equipo vuelve a
 * preguntar en ~10 s.
 */
const MAX_CLAIM_ATTEMPTS = 3;

/**
 * Entrega el comando en cola más antiguo del equipo (una sola vez, aun con sondeos concurrentes)
 * cuando éste consulta `getrequest`; devuelve su texto con `C:<n>:`, o `null` si no hay ninguno.
 */
export class TakeDeviceCommand implements UseCase<{ deviceId: string }, string | null> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { deviceId: string }): Promise<string | null> {
    const { deviceCommandRepository, clock, logger } = this.deps;

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const command = await deviceCommandRepository.nextQueued(input.deviceId as DeviceId);
      if (!command) return null;

      command.markSent(clock.now());
      if (await deviceCommandRepository.claim(command)) {
        logger.info(
          { deviceId: input.deviceId, commandId: command.id, number: command.number },
          'zkteco: comando entregado',
        );
        return command.wireText;
      }
    }
    return null;
  }
}
