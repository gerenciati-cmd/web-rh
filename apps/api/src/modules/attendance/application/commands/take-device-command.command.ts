import type { Clock, Logger } from '@/shared/application/ports';
import type { UseCase } from '@/shared/application/use-case';

import type { DeviceId } from '../../domain/device';
import type { DeviceCommandRepository } from '../../domain/device-command.repository';
import type { DeviceRepository } from '../../domain/device.repository';

interface Deps {
  deviceRepository: DeviceRepository;
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
 * Un equipo sin redes permitidas no recibe comandos: los pendientes siguen en cola (decisión 16
 * del README).
 */
export class TakeDeviceCommand implements UseCase<{ deviceId: string }, string | null> {
  constructor(private readonly deps: Deps) {}

  async execute(input: { deviceId: string }): Promise<string | null> {
    const { deviceRepository, deviceCommandRepository, clock, logger } = this.deps;

    const device = await deviceRepository.findById(input.deviceId as DeviceId);
    if (!device?.receivesCommands) return null;

    for (let attempt = 0; attempt < MAX_CLAIM_ATTEMPTS; attempt += 1) {
      const command = await deviceCommandRepository.nextQueued(device.id);
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
